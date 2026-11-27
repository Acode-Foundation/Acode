import WebKit

enum WebShadowCaret {
    static let script = """
        (() => {
            const nativeAddRange = Selection.prototype.addRange;
            if (nativeAddRange.name === 'acodeShadowCaretAddRange') return;
            Selection.prototype.addRange = function acodeShadowCaretAddRange(range) {
                const result = nativeAddRange.call(this, range);
                if (this.rangeCount || !range.collapsed) return result;
                const node = range.startContainer;
                const root = node.getRootNode();
                const editor = root instanceof ShadowRoot ? root.activeElement : null;
                if (!node.isConnected || node.ownerDocument !== document ||
                    this !== document.getSelection() || !editor?.isContentEditable ||
                    !editor.contains(node)) return result;
                // Document selections reject shadow-root Ranges in WebKit, even for a focused caret.
                this.setBaseAndExtent(node, range.startOffset, node, range.startOffset);
                return result;
            };
        })();
        """

    static func install(on controller: WKUserContentController) {
        guard !controller.userScripts.contains(where: { $0.source == script }) else { return }
        controller.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: false))
    }
}
