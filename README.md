# dtk-splitblame README

Allows you to see decomp toolkit splits inside of your symbols.txt.

## Features

Use the command pallette (Ctrl+Shift+P) option "Toggle DTK Split Blame" while in symbols.txt to toggle the display of a git-blame like visualisation of your splits.

Hover over the split name to get hyperlinks within your document to go to other parts of the same split(eg: going from .text to .sdata).

## Known Issues

The toggle is per editor tab group. Moving a tab to a new tab group will require you to toggle the blame view again once it's there. VSCode API makes it hard to track these.
