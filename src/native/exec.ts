import type { NativeExec } from "./bridge";

const exec: NativeExec = (...args) => window.Bridge.exec(...args);
export default exec;
