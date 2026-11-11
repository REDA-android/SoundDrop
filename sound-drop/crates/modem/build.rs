fn main() {
    println!("cargo:rerun-if-changed=../../vendor-references/ggwave/src/ggwave.cpp");
    println!("cargo:rerun-if-changed=../../vendor-references/ggwave/include/ggwave/ggwave.h");

    cc::Build::new()
        .cpp(true)
        .std("c++17")
        .file("../../vendor-references/ggwave/src/ggwave.cpp")
        .include("../../vendor-references/ggwave/include")
        .include("../../vendor-references/ggwave/src")
        .warnings(false)
        .compile("ggwave");
}
