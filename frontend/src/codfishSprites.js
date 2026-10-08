// Pixel fish shared by the SVG <Codfish/> and the Qubits vs Noise canvas. 160x96 grid.
// Each shape is ['path', d, fill], ['rect', x, y, w, h, fill] or ['bubble', x, y, size, stroke].
const dots=(xs,y,fill)=>xs.map(x=>['rect',x,y,4,4,fill]);
export const CODFISH_SPRITES={
  cod:[
    ['path','M8 28h12v12h12V28h16V16h32V8h32v8h20v12h12v40h-12v12h-20v8H64v-8H48V68H32V56H20v12H8z','#083145'],
    ['path','M16 36h8v12h16V36h16V24h64v8h16v32h-16v12H64V68H48V56H24v4h-8z','#82e5cf'],
    ['path','M56 24h64v8H56zM48 36h32v8H48z','#c6f7da'],
    ['path','M64 68h56v8H64zM80 76h16v8H80z','#38a6ab'],
    ['path','M72 16h24v8H72zM64 56h16v16H64z','#b6a1f4'],
    ['rect',104,32,16,20,'#effbff'],['rect',112,36,8,12,'#102c46'],
    ['rect',124,56,12,4,'#1d6675'],['rect',112,64,4,12,'#c6f7da'],
    ['rect',52,40,4,4,'#399ca2'],['rect',68,32,4,4,'#399ca2'],['rect',84,40,4,4,'#399ca2'],
    ['bubble',142,12,8,'#82dce4'],
  ],
  clown:[
    ['path','M12 28h16v12h16V28h16V20h56v8h16v12h12v24h-12v12h-16v8H60v-8H44V64H28v12H12z','#193755'],
    ['path','M20 36h8v12h24V32h16V28h44v8h16v12h8v12h-8v12h-16v4H68v-8H52V56H28v12h-8z','#ff9646'],
    ['path','M60 28h12v48H60zM92 28h12v48H92zM28 40h8v24h-8z','#fff2c8'],
    ['rect',112,40,12,16,'#153451'],
    ['bubble',142,12,8,'#86f1eb'],
  ],
  tang:[
    ['path','M12 32h16v12h16V28h16V16h56v12h16v12h12v24h-12v12h-16v8H60V72H44V56H28v12H12z','#162f59'],
    ['path','M48 36h20V24h40v12h16v12h12v12h-12v8h-16v8H68V64H48z','#439cff'],
    ['path','M20 40h12v8h16v8H32v4H20zM68 16h40v8H68z','#ffe363'],
    ['path','M64 40h40v8H80v16H64z','#214da1'],
    ['rect',112,40,12,12,'#effeff'],['rect',116,44,8,8,'#142944'],
    ['bubble',142,12,8,'#86f1eb'],
  ],
  puffer:[
    ['path','M52 8h12v12h12V8h12v12h16V8h12v20h12v12h16v12h-12v16h12v12h-28v8H64v-8H48V68H24V56H12V40h24V28h16z','#173c50'],
    ['path','M56 28h56v12h12v28h-12v12H64V68H48V40h8zM20 44h20v8H20z','#ffe36e'],
    ['path','M56 60h64v8h-8v12H64V68h-8z','#fff2c3'],
    ['rect',96,36,12,16,'#193451'],
    ...dots([56,72,88],44,'#c89c37'),
    ['bubble',142,12,8,'#86f1eb'],
  ],
  angel:[
    ['path','M76 4h16v12h16v16h16v12h20v16h-20v12h-16v12H92v8H76V76H56V64H32v12H16V28h16v12h24V28h20z','#163954'],
    ['path','M80 16h8v16h16v12h20v16h-20v12H88v12h-8V68H64V56H32v8h-8V40h8v8h32V36h16z','#e89dff'],
    ['path','M80 32h8v40h-8zM100 44h8v20h-8z','#ffe39a'],
    ['rect',112,44,8,12,'#1a3658'],
    ['bubble',142,12,8,'#86f1eb'],
  ],
  butterfly:[
    ['path','M12 28h16v12h20V28h16V16h40v12h16v12h16v28h-16v12h-16v8H64V76H48V60H28v12H12z','#193955'],
    ['path','M20 36h8v12h28V36h16V24h24v12h16v12h16v16h-16v8H96v8H72V68H56V52H28v12h-8z','#ffcd42'],
    ['path','M68 28h12v48H68zM92 36h8v36h-8z','#fff7d7'],
    ['rect',112,44,8,12,'#173451'],
    ['bubble',142,12,8,'#86f1eb'],
  ],
};
