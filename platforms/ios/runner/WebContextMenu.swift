import WebKit

final class WebContextMenu: NSObject, UIGestureRecognizerDelegate {
    private weak var webView: WKWebView?
    let gesture: UILongPressGestureRecognizer

    init(webView: WKWebView) {
        self.webView = webView
        gesture = UILongPressGestureRecognizer()
        super.init()
        gesture.minimumPressDuration = 0.45
        gesture.allowableMovement = 10
        gesture.cancelsTouchesInView = false
        gesture.delegate = self
        gesture.addTarget(self, action: #selector(handlePress))
        webView.addGestureRecognizer(gesture)
        webView.configuration.userContentController.addUserScript(
            WKUserScript(source: Self.script, injectionTime: .atDocumentStart, forMainFrameOnly: false)
        )
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                           shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
        true
    }

    @objc private func handlePress() {
        guard gesture.state == .began else { return }
        send()
    }

    func send() {
        webView?.evaluateJavaScript("window.acodeNativeContextMenu?.()", completionHandler: nil)
    }

    static let script = """
        (() => {
            let press, suppressed;
            let shadowRoots = [];
            const messageType = 'acode-native-contextmenu';
            const cancel = () => {
                press = null;
                for (const root of shadowRoots) root.removeEventListener('scroll', cancel, true);
                shadowRoots = [];
            };
            const reset = () => { cancel(); suppressed?.restoreCallout?.(); suppressed = null; };
            const receive = () => {
                if (press && !suppressed && press.target.isConnected &&
                    press.target.getAttribute('data-url') === press.url &&
                    performance.now() - press.started >= 400) {
                    const {target, pointerId, clientX, clientY} = press;
                    const event = new MouseEvent('contextmenu', {
                        bubbles: true, cancelable: true, composed: true,
                        button: 2, buttons: 2, clientX, clientY
                    });
                    suppressed = {target, pointerId, until: Infinity};
                    target.dispatchEvent(event);
                    const link = target.closest('a, img');
                    if (event.defaultPrevented && link) {
                        const value = link.style.getPropertyValue('-webkit-touch-callout');
                        const priority = link.style.getPropertyPriority('-webkit-touch-callout');
                        suppressed.restoreCallout = () => value
                            ? link.style.setProperty('-webkit-touch-callout', value, priority)
                            : link.style.removeProperty('-webkit-touch-callout');
                        link.style.setProperty('-webkit-touch-callout', 'none');
                    }
                }
                for (let i = 0; i < frames.length; i++)
                    frames[i].postMessage({type: messageType}, '*');
            };
            window.acodeNativeContextMenu = receive;
            window.addEventListener('message', event => {
                if (event.source === parent && event.data?.type === messageType)
                    receive();
            });
            document.addEventListener('pointerdown', event => {
                reset();
                if (event.pointerType !== 'touch' || !event.isPrimary) return;
                const target = event.composedPath()[0];
                if (!(target instanceof Element)) return;
                const current = press = {
                    target, pointerId: event.pointerId, clientX: event.clientX,
                    clientY: event.clientY, started: performance.now(), url: target.getAttribute('data-url')
                };
                shadowRoots = event.composedPath().filter(node => node instanceof ShadowRoot);
                for (const root of shadowRoots) root.addEventListener('scroll', cancel, true);
                queueMicrotask(() => { if (press === current && event.defaultPrevented) cancel(); });
            }, true);
            document.addEventListener('touchstart', event => {
                const current = press;
                queueMicrotask(() => { if (press === current && event.defaultPrevented) cancel(); });
            }, {capture: true, passive: true});
            document.addEventListener('pointermove', event => {
                if (event.pointerId === press?.pointerId &&
                    Math.hypot(event.clientX - press.clientX, event.clientY - press.clientY) > 10)
                    cancel();
            }, true);
            for (const type of ['pointerup', 'pointercancel'])
                document.addEventListener(type, event => {
                    if (event.pointerId === press?.pointerId) cancel();
                    if (event.pointerId === suppressed?.pointerId) suppressed.until = Date.now() + 700;
                }, true);
            document.addEventListener('contextmenu', event => {
                if (!event.isTrusted) return;
                if (suppressed && event.composedPath().includes(suppressed.target)) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                } else if (press) {
                    suppressed = {target: press.target, pointerId: press.pointerId, until: Infinity};
                    cancel();
                }
            }, true);
            document.addEventListener('click', event => {
                if (!event.isTrusted) return;
                if (event.detail && suppressed && Date.now() < suppressed.until) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                }
                reset();
            }, true);
            document.addEventListener('scroll', cancel, true);
            window.addEventListener('blur', reset);
            window.addEventListener('pagehide', reset);
        })();
        """
}
