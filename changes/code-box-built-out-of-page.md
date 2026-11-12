bump: patch

**A code box's caret no longer drifts below the line being edited.** A code box in the Properties panel is a
transparent textarea over a layer that draws the same text in colours, and the property table gives that layer the
textarea's line height, font and white-space once, as it makes it, from the textarea's computed style. The shell takes
a panel out of the document while another tab covers it, and there a computed style is empty: an object selected while
Properties was behind another tab (Parameters, say) got a layer with 16.9px lines under a textarea with 22px lines
(read in headless Chromium), so the caret stood 5px lower for every line down, and the layer's text lost its
indentation. The panel now builds what it built out of the page again once it is back in it
(`builder/panel.js`). The copy itself is the property table's (GUISTUFF, a submodule), and is still made once: this is
the host's side of it. `properties.check.mjs` builds a code box with the panel out of the page and holds the two line
heights equal.

**What to look at:** put the Parameters tab in front of Properties, select an object with code in the tree, then
bring Properties to the front and click into a line near the bottom of its code box: the caret is on the line you
clicked, and typing lands where the text is. If the caret still drifts, say which box (an object's code, a material's,
the Script panel) and at what browser zoom: that would be a second cause, not this one.
