fn main() {
    // The icons are compiled into the app by `generate_context!`, which only
    // runs when the crate is recompiled: a changed icon alone would leave the
    // old one in place. Watching the folder rebuilds the crate when they change.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
