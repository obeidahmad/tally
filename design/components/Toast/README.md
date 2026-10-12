# Toast

A short message at the bottom of the window that confirms what just happened. Provide the text, and an Undo action when the change can be reversed.

- After a delete: what was deleted and a quiet "Undo" button, for 6 seconds. Undo puts it back.
- After a save: one or two words ("Saved"), for 3 seconds, with no button.
- One toast at a time; a new one replaces the old. Give it `role="status"`.
- It sits at the bottom centre, and above the tab bar on phones. It never covers a dialog's buttons.
