/**
 * jsdom stubs `@xyflow/react` needs to mount at all: it measures nodes with `ResizeObserver`,
 * reads pane transforms through `DOMMatrixReadOnly`, and treats a zero-size container as "not
 * ready" (see React Flow's own testing guide). None of this exists in jsdom by default.
 */

class ResizeObserverMock {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  // React Flow measures each node via ResizeObserver and keeps it `visibility: hidden` (which
  // also drops it from the accessibility tree `getByRole` walks) until a callback reports its
  // size. jsdom never calls back on its own, so this stub invokes it synchronously with the
  // stubbed non-zero `offsetWidth`/`offsetHeight` below, exactly like React Flow's own testing
  // guide recommends.
  observe(target: Element): void {
    const width = (target as HTMLElement).offsetWidth || 800;
    const height = (target as HTMLElement).offsetHeight || 600;
    const size = [{ inlineSize: width, blockSize: height }];
    const entry = {
      target,
      contentRect: { x: 0, y: 0, width, height, top: 0, left: 0, right: width, bottom: height } as DOMRectReadOnly,
      borderBoxSize: size,
      contentBoxSize: size,
      devicePixelContentBoxSize: size,
    } as unknown as ResizeObserverEntry;
    this.callback([entry], this as unknown as ResizeObserver);
  }
  unobserve(): void {
    // no-op
  }
  disconnect(): void {
    // no-op
  }
}

if (!('ResizeObserver' in globalThis)) {
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserverMock }).ResizeObserver = ResizeObserverMock;
}

if (!('DOMMatrixReadOnly' in globalThis)) {
  // React Flow reads `m22` off a `DOMMatrixReadOnly` it builds from a node's CSS transform to
  // recover its zoom level; jsdom doesn't implement the type at all. Must be a real constructor
  // (an arrow function can't be `new`ed) — a class stub, per React Flow's own testing guide.
  class DOMMatrixReadOnlyMock {
    m22 = 1;
    constructor(..._args: unknown[]) {
      // no-op: only `m22` is read.
    }
  }
  (globalThis as unknown as { DOMMatrixReadOnly: unknown }).DOMMatrixReadOnly = DOMMatrixReadOnlyMock;
}

// jsdom elements report 0x0; React Flow's `useResizeHandler` treats that as "not measured" and
// never renders nodes. A non-zero fallback lets it settle immediately.
Object.defineProperties(globalThis.HTMLElement.prototype, {
  offsetHeight: {
    configurable: true,
    get(this: HTMLElement) {
      return Number.parseFloat(this.style.height) || 600;
    },
  },
  offsetWidth: {
    configurable: true,
    get(this: HTMLElement) {
      return Number.parseFloat(this.style.width) || 800;
    },
  },
});

if (typeof (globalThis.SVGElement.prototype as { getBBox?: unknown }).getBBox !== 'function') {
  (globalThis.SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect;
}
