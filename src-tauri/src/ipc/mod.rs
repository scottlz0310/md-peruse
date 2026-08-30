//! FrontendとRust間のIPC契約。
//!
//! 型はRust側を正本とし、TypeScriptの定義は `ts-rs` で生成する（dev-flow.md 5.1）。
//! 生成物は `src/types/generated/` へコミットし、CIが再生成して差分を検査する。

pub mod types;
