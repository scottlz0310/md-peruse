// Release ビルドで追加のコンソールウィンドウを出さない
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    md_peruse_lib::run()
}
