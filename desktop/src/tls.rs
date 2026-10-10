//! HTTPS on the same port as plain HTTP, so the web app can be a secure context (browsers only
//! allow the share sheet, i.e. "Save to Photos", there). Each connection's first byte says which
//! it is: TLS opens with a handshake record (0x16), HTTP with a method name. The native app keeps
//! using plain HTTP, so nothing changes for it, the pairing QR or mDNS.
//!
//! The certificate comes from a local CA this desktop creates on first run. A LAN IP can't get a
//! public certificate, so the phone installs the CA (`GET /ca.crt`) once and then trusts the hub.
//! The CA is name-constrained to private addresses, `.local` and `.ts.net`, so it can't vouch
//! for any other site, even if its key leaked. The server certificate is re-signed whenever the
//! machine's addresses change (Wi-Fi to Ethernet, a new DHCP lease, ...).

use crate::App;
use axum::serve::{IncomingStream, Listener};
use rcgen::{
    BasicConstraints, CertificateParams, CidrSubnet, DistinguishedName, DnType, ExtendedKeyUsagePurpose,
    GeneralSubtree, IsCa, Issuer, KeyPair, KeyUsagePurpose, NameConstraints,
};
use std::fmt;
use std::fs;
use std::io;
use std::net::IpAddr;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tokio_rustls::rustls::crypto::ring;
use tokio_rustls::rustls::pki_types::PrivatePkcs8KeyDer;
use tokio_rustls::rustls::server::{ClientHello, ResolvesServerCert};
use tokio_rustls::rustls::sign::CertifiedKey;
use tokio_rustls::rustls::ServerConfig;
use tokio_rustls::TlsAcceptor;

/// A client that connects but never finishes its first bytes / handshake is dropped after this.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
/// Server certificates last 397 days (under Apple's 398-day limit) and are renewed well before.
const LEAF_DAYS: i64 = 397;
const LEAF_RENEW: Duration = Duration::from_secs(30 * 24 * 3600);

pub struct Ca {
    issuer: Issuer<'static, KeyPair>,
    /// DER, served at `/ca.crt` for the phone to install.
    pub cert: Vec<u8>,
}

impl Ca {
    /// Loads the CA from `dir` (`ca-key.pem` + `ca.crt`), creating it on first run.
    pub fn load_or_create(dir: &Path) -> Result<Ca, String> {
        let (key_path, cert_path) = (dir.join("ca-key.pem"), dir.join("ca.crt"));
        let err = |e: &dyn fmt::Display| format!("HTTPS certificate: {e}");
        if let (Ok(key), Ok(cert)) = (fs::read_to_string(&key_path), fs::read(&cert_path)) {
            let key = KeyPair::from_pem(&key).map_err(|e| err(&e))?;
            // Signing only needs the CA's name and key, which are the same as when it was made.
            return Ok(Ca { issuer: Issuer::new(ca_params(), key), cert });
        }
        let key = KeyPair::generate().map_err(|e| err(&e))?;
        let cert = ca_params().self_signed(&key).map_err(|e| err(&e))?.der().to_vec();
        fs::create_dir_all(dir).map_err(|e| err(&e))?;
        write_private(&key_path, key.serialize_pem().as_bytes()).map_err(|e| err(&e))?;
        fs::write(&cert_path, &cert).map_err(|e| err(&e))?;
        Ok(Ca { issuer: Issuer::new(ca_params(), key), cert })
    }

    /// A fresh server certificate + key for `names` (IPs and DNS names).
    fn leaf(&self, names: &[String]) -> Result<CertifiedKey, String> {
        let mut params = CertificateParams::new(names.to_vec()).map_err(|e| e.to_string())?;
        params.distinguished_name.push(DnType::CommonName, "image-sync");
        params.key_usages = vec![KeyUsagePurpose::DigitalSignature];
        params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
        params.use_authority_key_identifier_extension = true;
        let now = time::OffsetDateTime::now_utc();
        // A day back, in case the phone's clock is a little behind.
        params.not_before = now - time::Duration::days(1);
        params.not_after = now + time::Duration::days(LEAF_DAYS);
        let key = KeyPair::generate().map_err(|e| e.to_string())?;
        let cert = params.signed_by(&key, &self.issuer).map_err(|e| e.to_string())?;
        let signer = ring::sign::any_supported_type(&PrivatePkcs8KeyDer::from(key.serialize_der()).into())
            .map_err(|e| e.to_string())?;
        Ok(CertifiedKey::new(vec![cert.der().clone()], signer))
    }
}

/// The only names the CA may vouch for (its name constraints). The server certificate must stay
/// inside them too: a single name outside, like a public IPv6 address, invalidates the whole thing.
const PERMITTED_DOMAINS: [&str; 3] = ["local", "localhost", "ts.net"]; // ts.net: Tailscale MagicDNS
const PERMITTED_NETS: [(&str, u8); 9] = [
    ("10.0.0.0", 8),
    ("172.16.0.0", 12),
    ("192.168.0.0", 16),
    ("100.64.0.0", 10), // CGNAT, incl. Tailscale
    ("169.254.0.0", 16),
    ("127.0.0.0", 8),
    ("fc00::", 7),
    ("fe80::", 10),
    ("::1", 128), // fc00::/7 above also covers Tailscale's fd7a:115c:a1e0::/48
];

fn in_net(ip: IpAddr, (net, prefix): (&str, u8)) -> bool {
    // Left-aligned in 128 bits, so a /prefix mask is the same for IPv4 and IPv6.
    let bits = |ip: IpAddr| match ip {
        IpAddr::V4(v4) => (u32::from(v4) as u128) << 96,
        IpAddr::V6(v6) => u128::from(v6),
    };
    let net: IpAddr = net.parse().unwrap();
    let mask = u128::MAX.checked_shl(128 - prefix as u32).unwrap_or(0);
    net.is_ipv4() == ip.is_ipv4() && bits(ip) & mask == bits(net) & mask
}

/// Whether the CA's name constraints allow `name` (an IP or a DNS name).
fn permitted(name: &str) -> bool {
    match name.parse::<IpAddr>() {
        Ok(ip) => PERMITTED_NETS.iter().any(|&net| in_net(ip, net)),
        Err(_) => PERMITTED_DOMAINS.iter().any(|d| name == *d || name.ends_with(&format!(".{d}"))),
    }
}

fn ca_params() -> CertificateParams {
    let mut params = CertificateParams::default();
    params.distinguished_name = DistinguishedName::new();
    params.distinguished_name.push(DnType::CommonName, "Image Sync local CA");
    params.distinguished_name.push(DnType::OrganizationName, "Image Sync");
    params.is_ca = IsCa::Ca(BasicConstraints::Constrained(0));
    params.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign];
    params.not_before = rcgen::date_time_ymd(2025, 1, 1);
    params.not_after = rcgen::date_time_ymd(2045, 1, 1);
    let domains = PERMITTED_DOMAINS.iter().map(|d| GeneralSubtree::DnsName(d.to_string()));
    let nets = PERMITTED_NETS
        .iter()
        .map(|&(net, prefix)| GeneralSubtree::IpAddress(CidrSubnet::from_addr_prefix(net.parse().unwrap(), prefix)));
    params.name_constraints = Some(NameConstraints {
        permitted_subtrees: domains.chain(nets).collect(),
        excluded_subtrees: Vec::new(),
    });
    params
}

#[cfg(unix)]
fn write_private(path: &Path, data: &[u8]) -> io::Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(path)?.write_all(data)
}

#[cfg(not(unix))]
fn write_private(path: &Path, data: &[u8]) -> io::Result<()> {
    fs::write(path, data)
}

/// The names the server certificate must cover right now: this machine's addresses, its `.local`
/// name, `localhost` and the optional remote address, as far as the CA may vouch for them.
pub fn current_names(app: &App) -> Vec<String> {
    let ips = if_addrs::get_if_addrs().into_iter().flatten().map(|i| i.ip().to_string());
    let host = [format!("{}.local", crate::host_name()), "localhost".into(), app.settings().remote_host.clone()];
    cert_names(ips.chain(host))
}

/// Keeps the names that may go in the certificate, sorted (so changes are easy to spot).
fn cert_names(candidates: impl Iterator<Item = String>) -> Vec<String> {
    let usable = |n: &String| match n.parse::<IpAddr>() {
        // Link-local IPv6 needs a zone id in a URL, so no browser connects by it.
        Ok(ip) => !in_net(ip, ("fe80::", 10)),
        // A hostname with spaces etc. can't go in a certificate.
        Err(_) => !n.is_empty() && n.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.'),
    };
    let mut names: Vec<String> = candidates.filter(|n| usable(n) && permitted(n)).collect();
    names.sort();
    names.dedup();
    names
}

type Names = Box<dyn Fn() -> Vec<String> + Send + Sync>;

struct Resolver {
    ca: Ca,
    /// What the certificate must cover right now; `current_names` outside tests.
    names: Names,
    current: Mutex<Option<(Vec<String>, Instant, Arc<CertifiedKey>)>>,
}

impl fmt::Debug for Resolver {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Resolver")
    }
}

impl ResolvesServerCert for Resolver {
    fn resolve(&self, _hello: ClientHello<'_>) -> Option<Arc<CertifiedKey>> {
        let names = (self.names)();
        let mut current = self.current.lock().unwrap();
        if let Some((n, made, key)) = &*current {
            if *n == names && made.elapsed() < LEAF_RENEW {
                return Some(key.clone());
            }
        }
        match self.ca.leaf(&names) {
            Ok(key) => {
                let key = Arc::new(key);
                *current = Some((names, Instant::now(), key.clone()));
                Some(key)
            }
            Err(e) => {
                eprintln!("HTTPS certificate for {names:?} failed: {e}");
                None
            }
        }
    }
}

pub fn acceptor(ca: Ca, names: impl Fn() -> Vec<String> + Send + Sync + 'static) -> Result<TlsAcceptor, String> {
    let resolver = Resolver { ca, names: Box::new(names), current: Mutex::new(None) };
    let mut config = ServerConfig::builder_with_provider(Arc::new(ring::default_provider()))
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .with_no_client_auth()
        .with_cert_resolver(Arc::new(resolver));
    // axum is built with HTTP/1 only.
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    Ok(TlsAcceptor::from(Arc::new(config)))
}

pub trait Io: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> Io for T {}

/// Who's connected, and whether over TLS (so `/images` hands out `https` links to them).
#[derive(Clone, Copy, Debug)]
pub struct Peer {
    pub tls: bool,
}

impl axum::extract::connect_info::Connected<IncomingStream<'_, DualListener>> for Peer {
    fn connect_info(stream: IncomingStream<'_, DualListener>) -> Self {
        *stream.remote_addr()
    }
}

/// A TCP listener whose connections are plain HTTP or TLS, told apart by their first byte.
/// Sniffing and handshakes run in their own tasks, so a slow client can't hold up the others.
pub struct DualListener {
    rx: mpsc::Receiver<(Box<dyn Io>, Peer)>,
}

impl DualListener {
    pub fn new(tcp: TcpListener, tls: TlsAcceptor) -> Self {
        let (tx, rx) = mpsc::channel(64);
        tokio::spawn(async move {
            loop {
                let (stream, _) = match tcp.accept().await {
                    Ok(conn) => conn,
                    // E.g. out of file descriptors; back off instead of spinning.
                    Err(_) => {
                        tokio::time::sleep(Duration::from_millis(100)).await;
                        continue;
                    }
                };
                let (tx, tls) = (tx.clone(), tls.clone());
                tokio::spawn(async move {
                    let mut first = [0u8; 1];
                    let peeked = tokio::time::timeout(HANDSHAKE_TIMEOUT, stream.peek(&mut first)).await;
                    let is_tls = matches!(peeked, Ok(Ok(1))) && first[0] == 0x16;
                    let io: Box<dyn Io> = if is_tls {
                        match tokio::time::timeout(HANDSHAKE_TIMEOUT, tls.accept(stream)).await {
                            Ok(Ok(s)) => Box::new(s),
                            _ => return,
                        }
                    } else {
                        Box::new(stream)
                    };
                    let _ = tx.send((io, Peer { tls: is_tls })).await;
                });
            }
        });
        DualListener { rx }
    }
}

impl Listener for DualListener {
    type Io = Box<dyn Io>;
    type Addr = Peer;

    async fn accept(&mut self) -> (Self::Io, Self::Addr) {
        match self.rx.recv().await {
            Some(conn) => conn,
            // The accept loop never ends, so this can't happen; never resolve rather than panic.
            None => std::future::pending().await,
        }
    }

    /// Only used for logging by axum; the real address lives on the inner TCP listener.
    fn local_addr(&self) -> io::Result<Self::Addr> {
        Ok(Peer { tls: false })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio_rustls::rustls::client::danger::ServerCertVerifier;
    use tokio_rustls::rustls::client::WebPkiServerVerifier;
    use tokio_rustls::rustls::pki_types::{CertificateDer, ServerName, UnixTime};
    use tokio_rustls::rustls::{ClientConfig, RootCertStore};

    fn temp_dir() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("image-sync-tls-{}", uuid::Uuid::new_v4()))
    }

    fn roots(ca: &[u8]) -> Arc<RootCertStore> {
        let mut roots = RootCertStore::empty();
        roots.add(CertificateDer::from(ca.to_vec())).unwrap();
        Arc::new(roots)
    }

    #[test]
    fn reloaded_ca_signs_certs_the_installed_one_trusts_but_only_for_local_names() {
        let dir = temp_dir();
        let installed = Ca::load_or_create(&dir).unwrap().cert;
        // What the phone installed was made by the first run; later runs reload the key.
        let ca = Ca::load_or_create(&dir).unwrap();
        assert_eq!(ca.cert, installed);
        let verifier = WebPkiServerVerifier::builder_with_provider(roots(&installed), Arc::new(ring::default_provider()))
            .build()
            .unwrap();
        let verify = |names: &[&str], name: &str| {
            let leaf = ca.leaf(&names.iter().map(|n| n.to_string()).collect::<Vec<_>>()).unwrap();
            let name = ServerName::try_from(name.to_string()).unwrap();
            verifier.verify_server_cert(&leaf.cert[0], &[], &name, &[], UnixTime::now()).is_ok()
        };
        assert!(verify(&["192.168.1.5", "box.local"], "192.168.1.5"));
        assert!(verify(&["192.168.1.5", "box.local"], "box.local"));
        assert!(verify(&["fd7a:115c:a1e0::1", "box.tail1234.ts.net"], "box.tail1234.ts.net"));
        assert!(!verify(&["192.168.1.5"], "192.168.1.6"), "name not in the cert");
        assert!(!verify(&["example.com"], "example.com"), "outside the CA's name constraints");
        assert!(!verify(&["8.8.8.8"], "8.8.8.8"), "public IP, outside the CA's name constraints");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn cert_names_stay_inside_the_name_constraints() {
        let names = cert_names(
            ["192.168.20.13", "2401:d002:c606:5b00::1", "fe80::1", "::1", "127.0.0.1", "fd7a:115c:a1e0::5", "100.101.1.2",
                "8.8.8.8", "Phungs-MacBook-Pro.local", "localhost", "box.tail1234.ts.net", "example.com", "evil-local",
                "My Mac.local", "", "localhost"]
            .map(String::from)
            .into_iter(),
        );
        let expected = ["100.101.1.2", "127.0.0.1", "192.168.20.13", "::1", "Phungs-MacBook-Pro.local", "box.tail1234.ts.net",
            "fd7a:115c:a1e0::5", "localhost"];
        assert_eq!(names, expected);

        // And a certificate for exactly those names verifies.
        let dir = temp_dir();
        let ca = Ca::load_or_create(&dir).unwrap();
        let verifier = WebPkiServerVerifier::builder_with_provider(roots(&ca.cert), Arc::new(ring::default_provider()))
            .build()
            .unwrap();
        let leaf = ca.leaf(&names).unwrap();
        let name = ServerName::try_from("192.168.20.13").unwrap();
        verifier.verify_server_cert(&leaf.cert[0], &[], &name, &[], UnixTime::now()).unwrap();
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn serves_plain_http_and_tls_on_one_port() {
        let dir = temp_dir();
        let ca = Ca::load_or_create(&dir).unwrap();
        let ca_cert = ca.cert.clone();
        tokio::runtime::Runtime::new().unwrap().block_on(async move {
            let tcp = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = tcp.local_addr().unwrap().port();
            let listener = DualListener::new(tcp, acceptor(ca, || vec!["127.0.0.1".into()]).unwrap());
            let router = axum::Router::new().route(
                "/",
                axum::routing::get(|axum::extract::ConnectInfo(p): axum::extract::ConnectInfo<Peer>| async move {
                    format!("tls={}", p.tls)
                }),
            );
            tokio::spawn(async move { axum::serve(listener, router.into_make_service_with_connect_info::<Peer>()).await });

            async fn get(mut io: impl AsyncRead + AsyncWrite + Unpin) -> String {
                io.write_all(b"GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n").await.unwrap();
                let mut out = String::new();
                io.read_to_string(&mut out).await.unwrap_or_default();
                out
            }
            let plain = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
            assert!(get(plain).await.ends_with("tls=false"));

            let config = ClientConfig::builder_with_provider(Arc::new(ring::default_provider()))
                .with_safe_default_protocol_versions()
                .unwrap()
                .with_root_certificates(roots(&ca_cert))
                .with_no_client_auth();
            let tcp = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
            let name = ServerName::try_from("127.0.0.1").unwrap();
            let tls = tokio_rustls::TlsConnector::from(Arc::new(config)).connect(name, tcp).await.unwrap();
            assert!(get(tls).await.ends_with("tls=true"));
        });
        fs::remove_dir_all(dir).unwrap();
    }
}
