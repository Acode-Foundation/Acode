import { TestRunner } from '../tester.js';

export async function runAceEditorTests(writeOutput) {
    const runner = new TestRunner('Ace Editor API Tests');

    let editor;
    let container;

    // Helper to create editor safely
    function createEditor() {
        container = document.createElement('div');
        container.style.width = '500px';
        container.style.height = '300px';
        container.style.backgroundColor = '#a02f2fff';
        document.body.appendChild(container);
        return ace.edit(container);
    }

    // Test 1: Ace is available
    runner.test('Ace is loaded', async (test) => {
        test.assert(typeof ace !== 'undefined', 'Ace should be available globally');
        test.assert(typeof ace.edit === 'function', 'ace.edit should be a function');
    });

    // Test 2: Editor creation
    runner.test('Editor creation', async (test) => {
        editor = createEditor();
        test.assert(editor != null, 'Editor instance should be created');
        test.assert(typeof editor.getSession === 'function', 'Editor should expose getSession');
    });

    // Test 3: Session access
    runner.test('Session access', async (test) => {
        const session = editor.getSession();
        test.assert(session != null, 'Editor session should exist');
        test.assert(typeof session.getValue === 'function', 'Session should expose getValue');
    });

    // Test 4: Set and get value
    runner.test('Set and get value', async (test) => {
        const text = 'Hello Ace Editor';
        editor.setValue(text, -1);
        const value = editor.getValue();
        test.assertEqual(value, text, 'Editor value should match the set value');
    });

    // Test 5: Cursor movement
    runner.test('Cursor movement', async (test) => {
        editor.setValue('line1\nline2\nline3', -1);
        editor.moveCursorTo(1, 2);

        const pos = editor.getCursorPosition();
        test.assertEqual(pos.row, 1, 'Cursor row should be correct');
        test.assertEqual(pos.column, 2, 'Cursor column should be correct');
    });

    // Test 6: Selection API
    runner.test('Selection handling', async (test) => {
        editor.setValue('abc\ndef', -1);
        editor.selectAll();

        const selected = editor.getSelectedText();
        test.assert(selected.length > 0, 'Selected text should not be empty');
    });

    // Test 7: Undo manager
    runner.test('Undo manager works', async (test) => {
        const session = editor.getSession();
        const undoManager = session.getUndoManager();

        session.setValue('one');
        undoManager.reset();

        editor.insert('\ntwo');
        editor.undo();

        const value = editor.getValue();
        test.assertEqual(value, 'one', 'Undo should revert last change');
    });


    // Test 8: Mode setting
    runner.test('Mode setting', async (test) => {
        const session = editor.getSession();
        session.setMode('ace/mode/javascript');

        const mode = session.getMode();
        test.assert(
            mode && mode.$id === 'ace/mode/javascript',
            'Editor mode should be JavaScript'
        );
    });

    // Test 9: Theme setting
    runner.test('Theme setting', async (test) => {
        editor.setTheme('ace/theme/monokai');
        const theme = editor.getTheme();
        test.assert(
            theme && theme.includes('monokai'),
            'Editor theme should be monokai'
        );
    });


    // Test 11: Line count
    runner.test('Line count', async (test) => {
        editor.setValue('a\nb\nc\nd', -1);
        const lines = editor.session.getLength();
        test.assertEqual(lines, 4, 'Editor should report correct number of lines');
    });

    // Test 12: Replace text
    runner.test('Replace text', async (test) => {
        editor.setValue('hello world', -1);
        editor.find('world');
        editor.replace('ace');

        const value = editor.getValue();
        test.assertEqual(value, 'hello ace', 'Replace should work correctly');
    });

    // Test 13: Search API
    runner.test('Search API', async (test) => {
        editor.setValue('foo bar foo', -1);
        editor.find('foo');

        const range = editor.getSelectionRange();
        test.assert(
            range.start.column === 0,
            'Search should select first match'
        );
    });

    // Test 14: Renderer availability
    runner.test('Renderer exists', async (test) => {
        const renderer = editor.renderer;
        test.assert(renderer != null, 'Editor renderer should exist');
        test.assert(
            typeof renderer.updateFull === 'function',
            'Renderer should expose updateFull'
        );
    });

    // Test 15: Editor options
    runner.test('Editor options', async (test) => {
        editor.setOption('showPrintMargin', false);
        const value = editor.getOption('showPrintMargin');
        test.assertEqual(value, false, 'Editor option should be applied');
    });

    // Test 16: Scroll API
    runner.test('Scroll API', async (test) => {
        editor.setValue(Array(100).fill('line').join('\n'), -1);
        editor.scrollToLine(50, true, true, () => { });

        const firstVisibleRow = editor.renderer.getFirstVisibleRow();
        test.assert(
            firstVisibleRow >= 0,
            'Editor should support scrolling'
        );
    });

    // Test 17: Redo manager
    runner.test('Redo manager works', (test) => {
        const session = editor.getSession();
        const undoManager = session.getUndoManager();

        session.setValue('one');
        undoManager.reset();

        session.insert({ row: 0, column: 3 }, '\ntwo');

        editor.undo();
        editor.redo();

        const value = editor.getValue();
        test.assertEqual(value, 'one\ntwo', 'Redo should restore undone change');
    });


    // Test 18: Focus and blur
    runner.test('Focus and blur', async (test) => {
        editor.focus();
        test.assert(editor.isFocused(), 'Editor should be focused');

        editor.blur();
        test.assert(!editor.isFocused(), 'Editor should be blurred');
    });


    // Cleanup
    runner.test('Cleanup editor', async (test) => {
        editor.destroy();
        container.remove();
        test.assert(true, 'Editor destroyed and DOM cleaned');
    });

    // Run all tests
    return await runner.run(writeOutput);
}
