/**
 * 大きさの変化を手で起こせる `ResizeObserver`。
 *
 * happy-domはレイアウトを持たず、実際の変化を通知しない。テストでは `install` で差し替え、
 * `notify` で観測中の要素へ通知を送る。実物と違い、観測を始めたときには通知しない。
 */
export class FakeResizeObserver {
  private static instances: FakeResizeObserver[] = [];
  private static original: typeof ResizeObserver | undefined;

  private readonly targets = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element) {
    this.targets.add(target);
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
  }

  static install() {
    FakeResizeObserver.original = globalThis.ResizeObserver;
    FakeResizeObserver.instances = [];
    globalThis.ResizeObserver =
      FakeResizeObserver as unknown as typeof ResizeObserver;
  }

  static uninstall() {
    if (FakeResizeObserver.original) {
      globalThis.ResizeObserver = FakeResizeObserver.original;
    }
    FakeResizeObserver.instances = [];
  }

  /** 観測中の要素があるすべての観測へ、大きさが変わったことを通知する。 */
  static notify() {
    for (const observer of FakeResizeObserver.instances) {
      if (observer.targets.size > 0) {
        observer.callback([], observer as unknown as ResizeObserver);
      }
    }
  }
}
