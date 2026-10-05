fn main() {
    // The phone app's web export (`pnpm web:export` at the repo root) is bundled as a resource,
    // and tauri-build fails on a missing resource path. Dev builds without an export just serve
    // an empty /app.
    std::fs::create_dir_all("../dist").expect("create ../dist");
    println!("cargo:rerun-if-changed=../dist");
    tauri_build::build()
}
