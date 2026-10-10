//======================================================================================================================
// A TABLE WITHOUT ITS FOLDER -- for a panel or popover that holds one folder.
//
//   untitledTable(table).addFolder({ title: 'Environment' })   // -> the table itself; its rows go in flat
//
// installUI puts each of its sections in a folder with a title. Where a section has a panel or a
// popover of its own, that title repeats what the tab or the icon already says ("Environment" inside
// the Environment panel) -- the user's rule is to say nothing twice. Rather than teach every writer of
// a section (addGroup, the size, output and test pages) a second way, the table goes to them behind a
// stand-in whose FIRST addFolder() is the table itself. A second folder keeps its title, so two
// folders in one place can still be told apart.
//
// Its own module so the shell's headless check (lib/shell/example.html) runs it on a real
// PropertyTable: installUI only runs with a GPU, and a Proxy over a Tweakpane pane is exactly the
// kind of thing that works for one caller and not the next.
//======================================================================================================================

export function untitledTable(table) {
    let used = false
    return new Proxy(table, {
        get: (o, k) => k === 'addFolder' && !used ? () => (used = true, o)
            : typeof o[k] === 'function' ? o[k].bind(o) : o[k],
    })
}
