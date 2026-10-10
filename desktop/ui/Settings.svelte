<script lang="ts">
  import { untrack } from 'svelte';
  import { removePhone, saveSettings, unpairAll, type Status } from './api';

  let { status, onsaved }: { status: Status; onsaved: () => void } = $props();

  // Seeded once; the 1 s status poll must not overwrite what's being typed.
  let library = $state(untrack(() => status.settings.library));
  let port = $state(untrack(() => status.settings.port));
  let remoteHost = $state(untrack(() => status.settings.remote_host));
  let tunnel = $state(untrack(() => status.settings.tunnel));
  let saved = $state('');

  async function save(e: SubmitEvent) {
    e.preventDefault();
    try {
      await saveSettings(library, port, remoteHost, tunnel);
      saved = 'Saved';
      onsaved(); // "In library" depends on the library folder
    } catch (err) {
      saved = String(err);
    }
  }

  // window.confirm() is a no-op returning false in Tauri's webview, so destructive buttons
  // arm on the first click and act on the second ('all' or a phone id).
  let armed = $state('');

  function arm(key: string, action: () => Promise<void>) {
    if (armed !== key) {
      armed = key;
      return;
    }
    armed = '';
    action().catch((err) => (saved = String(err)));
  }
</script>

<div class="page">
  <section>
    <h2>Pair a phone</h2>
    <div class="qr">{@html status.pairing_qr}</div>
    <p class="muted">Scan with Image Sync on your phone. Each code pairs one phone, then a new one appears.</p>
    <p class="muted">
      No camera on the phone? Choose this computer in Image Sync, or open
      <code>http://{status.lan_ip ?? 'this-computer'}:{status.settings.port}/app</code> in its browser,
      then type the 6-digit code that pops up here.
    </p>
    <p class="muted">
      To save straight to the phone's Photos from the browser, use
      <code>https://{status.lan_ip ?? 'this-computer'}:{status.settings.port}/app</code> instead. First install this
      computer's certificate on the phone from <code>http://{status.lan_ip ?? 'this-computer'}:{status.settings.port}/ca.crt</code>
      (iPhone: Settings › Profile Downloaded › Install, then General › About › Certificate Trust Settings › turn it on).
    </p>
  </section>

  <section>
    <h2>Paired phones</h2>
    {#each status.settings.phones as phone (phone.id)}
      <div class="phone">
        <span>{phone.name} <span class="muted">· paired {new Date(phone.paired * 1000).toLocaleDateString()}</span></span>
        <button onclick={() => arm(phone.id, () => removePhone(phone.id))}>
          {armed === phone.id ? 'Click again to unpair' : 'Unpair'}
        </button>
      </div>
    {:else}
      <p class="muted">None yet.</p>
    {/each}
    {#if status.settings.phones.length}<button onclick={() => arm('all', unpairAll)}>
        {armed === 'all' ? 'Click again: every phone must re-scan' : 'Unpair all phones'}
      </button>{/if}
  </section>

  <section>
    <h2>Settings</h2>
    <form onsubmit={save}>
      <label>Library folder <input type="text" bind:value={library} required /></label>
      <label>Port (applies on restart) <input type="number" bind:value={port} min="1024" max="65535" required /></label>
      <label>Remote address (optional, e.g. Tailscale name) <input type="text" bind:value={remoteHost} /></label>
      <label>Cloudflare tunnel name (optional, applies on restart) <input type="text" bind:value={tunnel} /></label>
      <button type="submit">Save</button> <span class="muted">{saved}</span>
    </form>
    <p class="muted">
      {status.ffmpeg
        ? 'ffmpeg found: video thumbnails on, AVCHD (.MTS) videos are converted to MP4 when synced.'
        : 'ffmpeg not found: no video thumbnails, and AVCHD (.MTS) videos are synced as-is.'}
    </p>
  </section>
</div>

<style>
  .page { overflow: auto; padding: 8px 16px 16px; }
  section { margin-bottom: 24px; max-width: 560px; }
  h2 { font-size: 13px; text-transform: uppercase; opacity: .6; margin: 0 0 8px; }
  label { display: block; margin: 8px 0; }
  input { width: 100%; box-sizing: border-box; padding: 6px; }
  .phone { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin: 6px 0; }
  .qr :global(svg) { background: #fff; padding: 8px; display: block; }
</style>
