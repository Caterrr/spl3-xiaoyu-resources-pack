(() => {
  const choices = [...document.querySelectorAll('.game-choice[data-game]')];
  const images = [...document.querySelectorAll('.portal-artwork img[data-game]')];
  const hover = matchMedia('(hover:hover) and (pointer:fine)');
  let hoveredGame;
  let focusedGame;

  function update() {
    const activeGame = hoveredGame || focusedGame;
    if (activeGame) document.body.dataset.previewGame = activeGame;
    else delete document.body.dataset.previewGame;
    for (const image of images) image.dataset.visible = String(image.dataset.game === activeGame);
  }

  for (const choice of choices) {
    choice.addEventListener('pointerenter', event => {
      if (hover.matches && event.pointerType !== 'touch') {
        hoveredGame = choice.dataset.game;
        update();
      }
    });
    choice.addEventListener('pointerleave', () => {
      if (hoveredGame === choice.dataset.game) hoveredGame = undefined;
      update();
    });
    choice.addEventListener('focus', () => {
      if (choice.matches(':focus-visible')) focusedGame = choice.dataset.game;
      update();
    });
    choice.addEventListener('blur', () => {
      focusedGame = undefined;
      update();
    });
  }
  hover.addEventListener('change', () => {
    hoveredGame = undefined;
    update();
  });
  window.addEventListener('pagehide', () => {
    hoveredGame = focusedGame = undefined;
    update();
  });
  update();
})();
