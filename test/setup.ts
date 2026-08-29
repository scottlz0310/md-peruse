// bun:test のプリロード。happy-dom をグローバルへ登録し、
// Testing Library が DOM を前提に動作できる状態にする。

import { afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

// React 19 の act() 警告を抑止し、更新をテスト側で同期的に flush させる。
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Testing Library は import 時点で document を参照するため、登録後に読み込む。
const { cleanup } = await import("@testing-library/react");

afterEach(cleanup);
