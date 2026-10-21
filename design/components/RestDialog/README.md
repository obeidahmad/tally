# RestDialog

The dialog for a section's rest rule: where the section's rest goes when a month closes. Provide the sections to choose from and the section's rule.

- It opens from the section's Rest rows on the Pipeline page. The title is "Rest of Needs" and the only action is "Save": a rest rule is never deleted. A new section's rule sends all of its rest to next month's income.
- The rest is what the section received that no subsection claimed, less what its subsections overspent.
- The rows are built like StepDialog's, in `ty-shares`: where the money goes (a select named "Goes to 1" and so on, offering "Next month's income" first, then every section, this one included), its percentage with a % sign, and a small quiet "Remove" when there is more than one row. "+ Add destination" adds a row, up to 8.
- Under the button: "Together the percentages make 100%." A rest rule is shares, never an amount.
- "When overspent, take it from" is a Segmented: "Next month's income" or "Needs next month". A rest below zero goes all to one place: either next month's income pays it back together with every other income, or the section's own money next month does.
