// Direct upload.wikimedia.org URLs (NOT Special:FilePath) so the CORS chain
// stays clean — Special:FilePath returns 302 without Access-Control-Allow-Origin,
// which causes browsers to reject crossorigin <img> loads needed for canvas export.
// URLs were resolved once via `Special:FilePath?width=1200` and baked here.
//
// images.unsplash.com is used where iconic tourist photography is better than
// the available Wikimedia upload — Unsplash sets Access-Control-Allow-Origin: *
// so the same canvas-export path works without modification.
export const WM_URLS = {
  flag:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Flag_of_Slovenia.svg/960px-Flag_of_Slovenia.svg.png",
  coat:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Coat_of_arms_of_Slovenia.svg/960px-Coat_of_arms_of_Slovenia.svg.png",
  dragon:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/6/61/Dragon_on_Dragon_Bridge_%28cropped%29.jpg/1280px-Dragon_on_Dragon_Bridge_%28cropped%29.jpg",
  dragon_unsplash:
    "https://images.unsplash.com/photo-1536349020714-59fb1d1a5387?w=2400&q=85",
  dragon_full:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/7/74/Dragons_Bridge%2C_Ljubljana_2.jpg/1280px-Dragons_Bridge%2C_Ljubljana_2.jpg",
  dragon_close:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/A_dragon_on_the_Dragon_Bridge_in_Ljubljana.jpg/1280px-A_dragon_on_the_Dragon_Bridge_in_Ljubljana.jpg",
  dragon_lamp:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/Lamp_post_on_the_Dragon_Bridge_%28Ljubljana%29.jpg/1280px-Lamp_post_on_the_Dragon_Bridge_%28Ljubljana%29.jpg",
  triglav:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0a/Triglav.jpg/1280px-Triglav.jpg",
  triglav_unsplash:
    "https://images.unsplash.com/photo-1550325135-704d38a59ac7?w=2400&q=85",
  triglav_snow:
    "https://images.unsplash.com/photo-1496736575916-bc932395087a?w=2400&q=85",
  triglav_clouds:
    "https://images.unsplash.com/photo-1447687643809-e05fd462f350?w=2400&q=85",
  triglav_green:
    "https://images.unsplash.com/photo-1469362102473-8622cfb973cd?w=2400&q=85",
  bled:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7f/Bled_island.jpg/1280px-Bled_island.jpg",
  bled_castle:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/Bled_Island_and_Bled_Castle%2C_Slovenia%2C_20240504_0908_8342.jpg/1280px-Bled_Island_and_Bled_Castle%2C_Slovenia%2C_20240504_0908_8342.jpg",
  bled_unsplash:
    "https://images.unsplash.com/photo-1562083589-3bf71182e9c2?w=2400&q=85",
  bled_sunrise:
    "https://images.unsplash.com/photo-1761081394839-fc67dfc2d715?w=2400&q=85",
  bled_boat:
    "https://images.unsplash.com/photo-1505159940484-eb2b9f2588e2?w=2400&q=85",
  predjama:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/H%C3%B6hlenburg_Predjama_in_Slovenien.jpg/1280px-H%C3%B6hlenburg_Predjama_in_Slovenien.jpg",
  predjama_unsplash:
    "https://images.unsplash.com/photo-1508860639366-a31bb8d06e97?w=2400&q=85",
  predjama_aerial:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Predjama_Castle%2C_Slovenia%2C_20240502_0833_7417.jpg/1280px-Predjama_Castle%2C_Slovenia%2C_20240502_0833_7417.jpg",
  predjama_view:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/5/57/Predjama_castle%2C_Slovenia.jpg/1280px-Predjama_castle%2C_Slovenia.jpg",
  predjama_cave:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e7/Predjama_Castle_cave_3.jpg/1280px-Predjama_Castle_cave_3.jpg",
  licitar:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Licitars2.jpg/1280px-Licitars2.jpg",
  licitar_single:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Licitar.JPG/1280px-Licitar.JPG",
  licitar_lectova:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/6/60/Lectova_srca_.jpg/1280px-Lectova_srca_.jpg",
  licitar_museum:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f5/GingerbreadMuseumRadovljica_%288%29.jpg/1280px-GingerbreadMuseumRadovljica_%288%29.jpg",
  bee:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Apis_mellifera_carnica_worker_hive_entrance_3.jpg/1280px-Apis_mellifera_carnica_worker_hive_entrance_3.jpg",
  bee_drone:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Apis_mellifera_carnica_drone_aborning.jpg/1280px-Apis_mellifera_carnica_drone_aborning.jpg",
  bee_honeycomb:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Apis_mellifera_carnica_worker_honeycomb_2.jpg/1280px-Apis_mellifera_carnica_worker_honeycomb_2.jpg",
  bee_macro:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/AD2009Aug08_Apis_mellifera_02.jpg/1280px-AD2009Aug08_Apis_mellifera_02.jpg",
  lipizzan:
    "https://upload.wikimedia.org/wikipedia/commons/b/bb/Lipica.jpg",
  lipizzan_horses:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ac/Lipica_horses_%287198987762%29.jpg/1280px-Lipica_horses_%287198987762%29.jpg",
  lipizzan_farm:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1c/Lipica_stud_farm_1.JPG/1280px-Lipica_stud_farm_1.JPG",
  lipizzan_stallion:
    "https://upload.wikimedia.org/wikipedia/commons/2/29/Lipizzaner_Stallion.jpg",
  olm:
    "https://upload.wikimedia.org/wikipedia/commons/f/f0/Proteus_anguinus_Postojnska_Jama_Slovenija.jpg",
  olm_vivarium:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/8/83/OlmInVivarium.jpg/1280px-OlmInVivarium.jpg",
  olm_alt:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fe/Olm_%282962444965%29.jpg/1280px-Olm_%282962444965%29.jpg",
  flute:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a6/Divje_Babe_flute_%28Late_Pleistocene_flute%29.jpg/1280px-Divje_Babe_flute_%28Late_Pleistocene_flute%29.jpg",
  zlatorog:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/Die_Gartenlaube_%281899%29_b_0177.jpg/1280px-Die_Gartenlaube_%281899%29_b_0177.jpg",
  kurent:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f5/Ale%C5%A1_Kravos_Kurentovanje_Ptuj_2019.jpg/1280px-Ale%C5%A1_Kravos_Kurentovanje_Ptuj_2019.jpg",
  kurent_night:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b6/Kurent_at_night.jpg/1280px-Kurent_at_night.jpg",
  kurent_close:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/1/13/Korant_Ptuj_02.jpg/1280px-Korant_Ptuj_02.jpg",
  kurent_group:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/6/67/Kurenti_na_Ptuju.jpg/1280px-Kurenti_na_Ptuju.jpg",
  kozolec:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b3/Hay_rack_%28Kozolec%29%2C_Bled%2C_Slovenia_%284813568556%29.jpg/1280px-Hay_rack_%28Kozolec%29%2C_Bled%2C_Slovenia_%284813568556%29.jpg",
  kozolec_museum:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f9/Bistrica%2C_%C5%A0entrupert_-_Simon%C4%8Di%C4%8D%27s_Hayrack_-_gallery.jpg/1280px-Bistrica%2C_%C5%A0entrupert_-_Simon%C4%8Di%C4%8D%27s_Hayrack_-_gallery.jpg",
  lipa:
    "https://upload.wikimedia.org/wikipedia/commons/9/95/NajevskaLipa1.JPG",
  lipa_najevska2:
    "https://upload.wikimedia.org/wikipedia/commons/1/12/NajevskaLipa2.JPG",
  lipa_tilia:
    "https://upload.wikimedia.org/wikipedia/commons/8/8b/Tilia_platyphyllos%2801%29.jpg",
  potica:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/7/75/Potica_%289501040588%29.jpg/1280px-Potica_%289501040588%29.jpg",
  potica_easter:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/42/Easter_eggs_and_Potica%2C_Slovenia.jpg/1280px-Easter_eggs_and_Potica%2C_Slovenia.jpg",
  potica_bled:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/2/22/Potica_na_Bledu.jpg/1280px-Potica_na_Bledu.jpg",
  potica_spread:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8e/Velika_no%C4%8D_-_jedila_hren_%C5%A1unka_pirhi_potica.jpg/1280px-Velika_no%C4%8D_-_jedila_hren_%C5%A1unka_pirhi_potica.jpg",
} as const;

export type ImgItem = {
  src: string;
  title: string;
  caption: string;
  fit?: "cover" | "contain";
  bg?: string;
};

export const FLAG_IMAGES: ImgItem[] = [
  {
    src: WM_URLS.flag,
    title: "Steagul Sloveniei",
    caption:
      "Trei dungi orizontale: alb, albastru, roșu. Pe partea stângă-sus apare stema cu Triglav, două linii ondulate (râurile/marea) și 3 stele aurii.",
    fit: "contain",
    bg: "#ffffff",
  },
  {
    src: WM_URLS.coat,
    title: "Stema Sloveniei",
    caption:
      "Vârful Triglav (alb) pe fond albastru, două linii ondulate (Marea Adriatică / râurile) și 3 stele aurii (preluate de la conții de Celje).",
    fit: "contain",
    bg: "#ffffff",
  },
];

export const SYMBOLS: ImgItem[] = [
  {
    src: WM_URLS.dragon,
    title: "Dragonul Ljubljanei",
    caption:
      "Statuile de pe Podul Dragonilor (Zmajski most). Dragonul este simbolul orașului Ljubljana — apare pe stemă și pe steagul orașului.",
  },
  {
    src: WM_URLS.dragon_unsplash,
    title: "Dragonul Ljubljanei (variantă, golden hour)",
    caption:
      "Aceeași statuie de pe Zmajski most surprinsă în lumina apusului — auriu cald, cer roz. Foto: Aneta Pawlik (Unsplash).",
  },
  {
    src: WM_URLS.dragon_full,
    title: "Podul Dragonilor (vedere completă)",
    caption:
      "Întregul Zmajski most peste râul Ljubljanica — patru dragoni de bronz la cele patru colțuri. Construit în 1900–1901, primul pod cu beton armat din Ljubljana.",
  },
  {
    src: WM_URLS.dragon_close,
    title: "Dragon — detaliu sculptural",
    caption:
      "Prim-plan cu unul dintre dragonii de bronz: aripi desfăcute, limba scoasă. Sculptura este opera lui Jurij Zaninović (Viena).",
  },
  {
    src: WM_URLS.dragon_lamp,
    title: "Dragon și felinar (Art Nouveau)",
    caption:
      "Dragon împreună cu felinarul de fier forjat în stil Secession (Art Nouveau vienez). Detaliu emblematic pentru fotografii nocturne.",
  },
  {
    src: WM_URLS.triglav,
    title: "Muntele Triglav (2.864 m)",
    caption:
      "Cel mai înalt munte din Slovenia, cu 3 vârfuri caracteristice. Apare pe stemă, pe bancnote, pe moneda de 50 cenți și pe tricoul echipei naționale de fotbal.",
  },
  {
    src: WM_URLS.triglav_unsplash,
    title: "Triglav (variantă — perete stâncos)",
    caption:
      "Vedere apropiată a peretelui stâncos al Triglavului din Munții Iulieni. Foto: Sébastien Goldberg (Unsplash).",
  },
  {
    src: WM_URLS.triglav_snow,
    title: "Triglav (iarna, înzăpezit)",
    caption:
      "Vârful înzăpezit învăluit în nori dramatici — vederea sub furtună. Foto: Davorin Pavlica (Unsplash).",
  },
  {
    src: WM_URLS.triglav_clouds,
    title: "Triglav (Munții Iulieni, înnorat)",
    caption:
      "Crestele de calcar ale Triglavului în lumina nordică, cu nori în alb-gri. Foto: Aleš Krivec (Unsplash).",
  },
  {
    src: WM_URLS.triglav_green,
    title: "Triglav (vară, pajiști alpine)",
    caption:
      "Pajiști verzi de înălțime în zona Triglavului, cu vegetație alpină în plină vară. Foto: Aleš Krivec (Unsplash).",
  },
  {
    src: WM_URLS.bled,
    title: "Lacul Bled",
    caption:
      "Insula cu bisericuța (Cerkev Marijinega vnebovzetja) în mijlocul lacului — cea mai fotografiată imagine a Sloveniei.",
  },
  {
    src: WM_URLS.bled_castle,
    title: "Lacul Bled (cu Castelul Bled)",
    caption:
      "Vedere panoramică: insula cu bisericuța și, deasupra stâncii, Castelul Bled (sec. XI) — cel mai vechi castel din Slovenia.",
  },
  {
    src: WM_URLS.bled_unsplash,
    title: "Lacul Bled (vedere aeriană)",
    caption:
      "Insula văzută de sus — apele turcoaz și bisericuța albă în centru. Foto: Unsplash.",
  },
  {
    src: WM_URLS.bled_sunrise,
    title: "Lacul Bled (răsărit)",
    caption:
      "Răsărit de soare peste lac, cu insula în prim-plan și munții în depărtare. Foto: Haonan Wei (Unsplash).",
  },
  {
    src: WM_URLS.bled_boat,
    title: "Lacul Bled (barcă pletna)",
    caption:
      "Barcă tradițională „pletna” pe luciul apei la răsărit — bărcile cu care turiștii sunt duși la insulă. Foto: Artem Sapegin (Unsplash).",
  },
  {
    src: WM_URLS.predjama,
    title: "Castelul Predjama",
    caption:
      "Castel construit într-o peșteră, sub o stâncă de 123 m. Cel mai mare castel-peșteră din lume (Cartea Recordurilor).",
  },
  {
    src: WM_URLS.predjama_unsplash,
    title: "Castelul Predjama (variantă — fațadă)",
    caption:
      "Vedere frontală a fațadei albe încastrate în peretele de stâncă. Foto: Chris Yang (Unsplash).",
  },
  {
    src: WM_URLS.predjama_aerial,
    title: "Castelul Predjama (vedere de aproape)",
    caption:
      "Detaliu cu fațada și peretele de stâncă — se vede clar cum castelul este lipit de gura peșterii.",
  },
  {
    src: WM_URLS.predjama_view,
    title: "Castelul Predjama (vedere clasică)",
    caption:
      "Castelul în întreg cadrul, cu valea verde în prim-plan — perspectiva folosită cel mai des în ghiduri turistice.",
  },
  {
    src: WM_URLS.predjama_cave,
    title: "Castelul Predjama (peștera de sub castel)",
    caption:
      "Peștera de sub castel, cu rețea de tuneluri secrete folosite de cavalerul Erazem din Predjama (sec. XV) pentru a rezista asediului.",
  },
  {
    src: WM_URLS.licitar,
    title: "Licitarsko srce",
    caption:
      "Inima roșie din turtă dulce decorată — simbol tradițional sloven și croat, oferită ca semn de prietenie sau dragoste.",
  },
  {
    src: WM_URLS.licitar_single,
    title: "Licitar (variantă, inimă unică)",
    caption:
      "O singură inimă de licitar pe fundal alb — bună pentru imprimare clară pe afiș de stand.",
  },
  {
    src: WM_URLS.licitar_lectova,
    title: "Licitar (lectova srca, expoziție)",
    caption:
      "Mai multe inimi (lectova srca) cu decorațiuni diferite — variante de culoare și mesaj.",
  },
  {
    src: WM_URLS.licitar_museum,
    title: "Licitar (Muzeul turtei dulci, Radovljica)",
    caption:
      "Muzeul Lectar din Radovljica (Slovenia) — atelier de licitar funcțional din 1766, deschis public.",
  },
  {
    src: WM_URLS.bee,
    title: "Albina carniolică",
    caption:
      "Apis mellifera carnica — rasa autohtonă de albine. Slovenia a propus, în 2018, instituirea Zilei Mondiale a Albinelor (20 mai).",
  },
  {
    src: WM_URLS.bee_drone,
    title: "Albina carniolică (trântor)",
    caption:
      "Trântor (mascul) ieșind din celulă — albinele carniolice sunt cunoscute pentru blândețe și rezistență la frig.",
  },
  {
    src: WM_URLS.bee_honeycomb,
    title: "Albina carniolică (pe fagure)",
    caption:
      "Lucrătoare pe fagurele de miere — Slovenia are aproximativ 10.000 de apicultori la 2 milioane de locuitori.",
  },
  {
    src: WM_URLS.bee_macro,
    title: "Albina (macro, pe floare)",
    caption:
      "Detaliu macro al albinei pe floare — bun pentru ilustrarea polenizării și a Zilei Mondiale a Albinelor.",
  },
  {
    src: WM_URLS.lipizzan,
    title: "Calul Lipițan",
    caption:
      "Rasă cabalină originară din Lipica (Slovenia), crescută din 1580. Caii albi sunt celebri pentru spectacolele Școlii Spaniole de Călărie din Viena.",
  },
  {
    src: WM_URLS.lipizzan_horses,
    title: "Lipițani (turmă pe pășune)",
    caption:
      "Mai mulți lipițani albi pe pășune la herghelia din Lipica — mânjii se nasc negri și se albesc cu vârsta.",
  },
  {
    src: WM_URLS.lipizzan_farm,
    title: "Herghelia din Lipica",
    caption:
      "Clădirea istorică a hergheliei (1580) — cea mai veche herghelie europeană în funcțiune neîntrerupt.",
  },
  {
    src: WM_URLS.lipizzan_stallion,
    title: "Armăsar lipițan (portret)",
    caption:
      "Portret al unui armăsar adult — capul nobil, gâtul puternic, statura compactă specifică rasei.",
  },
  {
    src: WM_URLS.olm,
    title: "Proteul (olm) — „pestișorul-dragon”",
    caption:
      "Proteus anguinus — amfibian orb care trăiește exclusiv în peșterile carstice (ex. Postojna). Trăiește peste 100 de ani și poate sta nemâncat 10 ani.",
  },
  {
    src: WM_URLS.olm_vivarium,
    title: "Proteul (în vivariu)",
    caption:
      "Proteul observat în vivariul peșterii Postojna — pielea translucidă lasă să se vadă organele interne.",
  },
  {
    src: WM_URLS.olm_alt,
    title: "Proteul (vedere apropiată)",
    caption:
      "Detaliu cu branhiile externe roșii și ochii rudimentari acoperiți de piele — adaptări la viața în întuneric total.",
  },
  {
    src: WM_URLS.flute,
    title: "Flautul de la Divje Babe",
    caption:
      "Os de urs cu găuri, vechi de ~60.000 de ani — considerat cel mai vechi instrument muzical din lume. Descoperit într-o peșteră din vestul Sloveniei.",
  },
  {
    src: WM_URLS.zlatorog,
    title: "Zlatorog (Capra de Aur)",
    caption:
      "Capra-neagră albă cu coarne de aur din mitologia slovenă. Trăiește în Munții Triglav și își păzește comoara — cel mai cunoscut personaj legendar al Sloveniei. Apare ca emblemă a berii Laško Zlatorog.",
    fit: "contain",
    bg: "#ffffff",
  },
  {
    src: WM_URLS.kurent,
    title: "Kurent (Kurentovanje)",
    caption:
      "Figură carnavalească cu blană de oaie, mască și clopote mari la brâu — alungă iarna și aduce primăvara. Carnavalul de la Ptuj este patrimoniu cultural imaterial UNESCO din 2017.",
  },
  {
    src: WM_URLS.kurent_night,
    title: "Kurent (noaptea, în Ptuj)",
    caption:
      "Kurent fotografiat seara, cu măștile și clopotele luminate de lumina stradală — atmosferă spectaculoasă a carnavalului.",
  },
  {
    src: WM_URLS.kurent_close,
    title: "Kurent (prim-plan mască)",
    caption:
      "Detaliu cu masca tradițională (kurentova maska) — coarne, dinți, panglici colorate. Fiecare mască este unică, lucrată manual.",
  },
  {
    src: WM_URLS.kurent_group,
    title: "Kurenti (grup în Ptuj)",
    caption:
      "Mai mulți kurenti împreună la Kurentovanje — pe străzile orașului Ptuj. Sărbătoarea ține 10 zile, înainte de Postul Mare.",
  },
  {
    src: WM_URLS.kozolec,
    title: "Kozolec (clăile slovene)",
    caption:
      "Uscător de fân tradițional din lemn, considerat element arhitectural distinct sloven. Apare în peisajul rural ca simbol al satului — există chiar și un muzeu în aer liber dedicat lui (Šentrupert).",
  },
  {
    src: WM_URLS.kozolec_museum,
    title: "Kozolec (Muzeul Šentrupert)",
    caption:
      "Galerie de kozolec-uri la Dežela kozolcev (Țara clăilor) din Šentrupert — primul muzeu în aer liber din Europa dedicat clăilor.",
  },
  {
    src: WM_URLS.lipa,
    title: "Lipa (Teiul, arborele național)",
    caption:
      "Arborele național al Sloveniei (și simbol al popoarelor slave). Sub teiul satului se țineau adunările vechi. Najevska lipa, veche de peste 700 de ani, este cel mai vestit tei din Slovenia.",
  },
  {
    src: WM_URLS.lipa_najevska2,
    title: "Najevska lipa (variantă)",
    caption:
      "Altă vedere a Najevskei lipe (Slovenia) — sub acest tei se ținea anual adunarea președinților Sloveniei.",
  },
  {
    src: WM_URLS.lipa_tilia,
    title: "Tei european (Tilia platyphyllos)",
    caption:
      "Tei mare, în floare — specia europeană (Tilia platyphyllos) folosită ca arbore al satului. Florile sunt și plantă medicinală tradițională.",
  },
  {
    src: WM_URLS.potica,
    title: "Potica",
    caption:
      "Cozonacul rulat tradițional sloven — umplut cu nucă, mac, tarhon sau miere. Produs cu denumire de origine protejată (UE) și prezent pe orice masă de sărbătoare.",
  },
  {
    src: WM_URLS.potica_easter,
    title: "Potica (cu ouă de Paște)",
    caption:
      "Potica alături de ouăle încondeiate — masă tradițională slovenă de Paște (Velika noč).",
  },
  {
    src: WM_URLS.potica_bled,
    title: "Potica (la Bled)",
    caption:
      "Potica servită ca desert pe malul Lacului Bled — varianta cu nucă (orehova potica) este cea mai populară.",
  },
  {
    src: WM_URLS.potica_spread,
    title: "Masa de Paște slovenă",
    caption:
      "Masa completă de Paște: hrean, șuncă, ouă încondeiate (pirhi) și potica — ansamblul tradițional „velikonočna jedila”.",
  },
];

export const PHRASES: Array<{ sl: string; ro: string; ipa?: string }> = [
  { sl: "Zdravo", ro: "Bună!", ipa: "[zdrávo]" },
  { sl: "Dober dan", ro: "Bună ziua", ipa: "[dóber dán]" },
  { sl: "Hvala", ro: "Mulțumesc", ipa: "[hvála]" },
  { sl: "Prosim", ro: "Te rog / Cu plăcere", ipa: "[prósim]" },
  { sl: "Nasvidenje", ro: "La revedere", ipa: "[nasvídenje]" },
  { sl: "Da / Ne", ro: "Da / Nu" },
  { sl: "Kako se imenuješ?", ro: "Cum te cheamă?" },
  { sl: "Sem iz Romunije", ro: "Sunt din România" },
];

export const ALL_IMAGE_ITEMS: ImgItem[] = [...FLAG_IMAGES, ...SYMBOLS];

// Sentinel keys used to identify special (non-photo) cards in the
// selection set alongside image src URLs.
export const PHRASES_KEY = "__phrases__";
export const STEMA_SHEET_KEY = "__stema_sheet__";

export const SLUG = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// Detail-page slugs used in URLs like /coursework/.../images/<slug>.
export const PHRASES_DETAIL_SLUG = "cuvinte-de-baza";
export const STEMA_SHEET_DETAIL_SLUG = "stema-fisa-decupat";

// For per-item navigation: returns the image item plus its index in
// ALL_IMAGE_ITEMS, OR a special-card flag, OR null if not found.
export function findItemBySlug(
  imageSlug: string,
):
  | { kind: "image"; item: ImgItem; index: number }
  | { kind: "phrases" }
  | { kind: "stema_sheet" }
  | null {
  if (imageSlug === PHRASES_DETAIL_SLUG) return { kind: "phrases" };
  if (imageSlug === STEMA_SHEET_DETAIL_SLUG) return { kind: "stema_sheet" };
  const idx = ALL_IMAGE_ITEMS.findIndex((i) => SLUG(i.title) === imageSlug);
  if (idx === -1) return null;
  return { kind: "image", item: ALL_IMAGE_ITEMS[idx]!, index: idx };
}

// Ordered list of every detail-page slug — used by prev/next navigation.
export const ALL_DETAIL_SLUGS: string[] = [
  ...ALL_IMAGE_ITEMS.map((i) => SLUG(i.title)),
  PHRASES_DETAIL_SLUG,
  STEMA_SHEET_DETAIL_SLUG,
];
