/** Props that make a row or card selectable from the mouse and the keyboard. */
export const pick = (onOpen: () => void) => ({
  role: 'button' as const,
  tabIndex: 0,
  onClick: onOpen,
  onKeyDown: (e: { key: string; preventDefault(): void }) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); }
  },
});
