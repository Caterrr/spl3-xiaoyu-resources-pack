(() => {
 const shared=[['weapons','武器'],['skills','技能'],['maps','地图'],['scenes','场景'],['props','杂物'],['characters','角色'],['decor','装饰']];
 const games={spl3:{key:'spl3',name:'喷3',defaultSection:'new',sections:[['old','旧武器'],['new','新武器'],['sub-special','技能'],['maps','地图'],['scenes','场景'],['props','杂物'],['characters','角色'],['decor','装饰']]},raiders:{key:'raiders',name:'涂击队',defaultSection:'weapons',sections:[...shared.slice(0,-1),['clothing','服装'],shared.at(-1)]},phantom:{key:'phantom',name:'幻界',emptyMessage:'资源待补充',defaultSection:'weapons',sections:shared}};
 const params=new URLSearchParams(location.search);const game=games[params.get('game')]||games.spl3;window.libraryGame=game;
 document.documentElement.dataset.game=game.key;
})();
