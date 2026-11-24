(function () {
  "use strict";

  var DATA = window.M5S_DATA;
  if (!DATA) return;

  function basePath() {
    var path = window.location.pathname || "";
    return path.indexOf("/comuni/") !== -1 ? "../" : "";
  }

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function mediaUrl(path) {
    var value = String(path || "").trim();
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value;
    if (value.charAt(0) === "/") value = value.slice(1);
    return basePath() + value;
  }

  function safeUrl(url) {
    var value = String(url || "").trim();
    if (!value || /^\s*javascript:/i.test(value) || /^\s*data:/i.test(value)) return "";
    if (/^(https?:|mailto:)/i.test(value)) return value;
    if (value.charAt(0) === "#") return value;
    if (value.charAt(0) === "/" || value.indexOf("..") === -1 && /^[\w./~-]+$/.test(value)) return value;
    return "";
  }

  function inlineMarkdown(src) {
    var text = escapeHtml(src);
    text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (_all, alt, url) {
      var safe = safeUrl(url);
      if (!safe) return alt;
      return '<img src="' + escapeHtml(mediaUrl(safe)) + '" alt="' + alt + '">';
    });
    text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_all, label, url) {
      var safe = safeUrl(url);
      if (!safe) return label;
      var external = /^https?:\/\//i.test(safe);
      return '<a href="' + escapeHtml(safe) + '"' + (external ? ' target="_blank" rel="noopener noreferrer"' : "") + ">" + label + "</a>";
    });
    text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
    return text;
  }

  function renderMarkdown(src) {
    var lines = String(src || "").replace(/\r\n/g, "\n").split("\n");
    var html = [];
    var para = [];
    var list = null;

    function flushPara() {
      if (!para.length) return;
      html.push("<p>" + para.map(inlineMarkdown).join("<br>") + "</p>");
      para = [];
    }

    function closeList() {
      if (!list) return;
      html.push("</" + list + ">");
      list = null;
    }

    lines.forEach(function (line) {
      var trimmed = line.trim();
      var heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
      var bullet = /^[-*]\s+(.+)$/.exec(trimmed);
      var numbered = /^\d+\.\s+(.+)$/.exec(trimmed);
      if (!trimmed) {
        flushPara();
        closeList();
        return;
      }
      if (heading) {
        flushPara();
        closeList();
        var level = heading[1].length + 1;
        if (level > 3) level = 3;
        html.push("<h" + level + ">" + inlineMarkdown(heading[2]) + "</h" + level + ">");
        return;
      }
      if (bullet || numbered) {
        flushPara();
        var kind = bullet ? "ul" : "ol";
        if (list !== kind) {
          closeList();
          list = kind;
          html.push("<" + kind + ">");
        }
        html.push("<li>" + inlineMarkdown((bullet || numbered)[1]) + "</li>");
        return;
      }
      closeList();
      para.push(trimmed);
    });
    flushPara();
    closeList();
    return html.join("");
  }

  function imageHtml(article) {
    if (!article || !article.immagine) return "";
    return '<img class="articolo-img" src="' + escapeHtml(mediaUrl(article.immagine)) + '" alt="">';
  }

  function formatDate(iso) {
    var parts = String(iso).split("-");
    if (parts.length !== 3) return iso;
    return parts[2] + "/" + parts[1] + "/" + parts[0];
  }

  function findComune(slug) {
    for (var i = 0; i < DATA.comuni.length; i++) {
      if (DATA.comuni[i].slug === slug) return DATA.comuni[i];
    }
    return null;
  }

  function sortedArticles() {
    return DATA.articles.slice().sort(function (a, b) {
      if (a.data === b.data) return a.id < b.id ? 1 : -1;
      return a.data < b.data ? 1 : -1;
    });
  }

  function articlesByComune(slug) {
    return sortedArticles().filter(function (a) {
      return a.comune === slug;
    });
  }

  function articlesGruppo(tipo) {
    return sortedArticles().filter(function (a) {
      if (!a.gruppo) return false;
      if (!tipo || tipo === "tutti") return true;
      var proprio = a.tipo === "comunicato" ? "comunicato" : "articolo";
      return proprio === tipo;
    });
  }

  function vociUfficiali(fonte) {
    var lista = ((window.M5S_UFFICIALE && window.M5S_UFFICIALE.voci) || []).slice();
    if (fonte === "nazionale" || fonte === "regionale") {
      lista = lista.filter(function (v) { return v.fonte === fonte; });
    }
    lista.sort(function (a, b) {
      return String(b.data || "").localeCompare(String(a.data || ""));
    });
    return lista;
  }

  function findArticle(id) {
    for (var i = 0; i < DATA.articles.length; i++) {
      if (DATA.articles[i].id === id) return DATA.articles[i];
    }
    return null;
  }

  function tipoLabel(tipo) {
    if (tipo === "comunicato") return "Comunicato stampa";
    if (tipo === "nazionale") return "Dal Nazionale";
    if (tipo === "regionale") return "Dal Regionale";
    return "Articolo";
  }

  function cardVoce(voce, base, heading) {
    var tag = heading || "h3";
    var fonte = voce.fonte === "regionale" ? "regionale" : "nazionale";
    var logo = voce.logo
      ? '<img src="' + base + escapeHtml(voce.logo) + '" alt="" width="28" height="28">'
      : "";
    var quando = formatDate(voce.data);
    var anteprima = voce.anteprima
      ? '<p class="notizia-anteprima">' + escapeHtml(voce.anteprima) + "</p>"
      : "";
    var nome = voce.fonteNome || "Movimento 5 Stelle";
    return (
      '<article class="card notizia">' +
      '<p class="notizia-testata">' +
      logo +
      "<span>" + escapeHtml(nome) + "</span>" +
      (quando ? '<time datetime="' + escapeHtml(voce.data) + '">' + escapeHtml(quando) + "</time>" : "") +
      "</p>" +
      '<p class="meta"><span class="badge-tipo badge-' + fonte + '">' + escapeHtml(voce.etichetta || tipoLabel(fonte)) + "</span></p>" +
      "<" + tag + '><a href="' + escapeHtml(voce.url) + '" target="_blank" rel="noopener noreferrer">' +
      escapeHtml(voce.titolo) +
      "</a></" + tag + ">" +
      anteprima +
      '<p class="notizia-leggi"><a href="' + escapeHtml(voce.url) + '" target="_blank" rel="noopener noreferrer">Leggi su ' +
      escapeHtml(nome) +
      "</a></p>" +
      "</article>"
    );
  }

  function featuredVoce(voce, base) {
    var fonte = voce.fonte === "regionale" ? "regionale" : "nazionale";
    var logo = voce.logo
      ? '<img class="logo-fonte" src="' + base + escapeHtml(voce.logo) + '" alt="" width="36" height="36">'
      : "";
    var nome = voce.fonteNome || "Movimento 5 Stelle";
    return (
      '<article class="featured">' +
      '<p class="page-kicker">' + escapeHtml(voce.etichetta || tipoLabel(fonte)) + "</p>" +
      '<p class="notizia-testata">' + logo + "<span>" + escapeHtml(nome) + "</span>" +
      '<time datetime="' + escapeHtml(voce.data) + '">' + escapeHtml(formatDate(voce.data)) + "</time></p>" +
      "<h2><a href=\"" + escapeHtml(voce.url) + "\" target=\"_blank\" rel=\"noopener noreferrer\">" +
      escapeHtml(voce.titolo) + "</a></h2>" +
      (voce.anteprima ? '<p class="excerpt">' + escapeHtml(voce.anteprima) + "</p>" : "") +
      '<a class="leggi-tutto" href="' + escapeHtml(voce.url) + '" target="_blank" rel="noopener noreferrer">Leggi su ' +
      escapeHtml(nome) + "</a>" +
      "</article>"
    );
  }

  function metaHtml(article, base) {
    var badge = article.esempio
      ? '<span class="badge-esempio">Articolo di esempio</span>'
      : "";
    var tipo = article.tipo === "comunicato" ? "comunicato" : "articolo";
    var etichetta =
      '<span class="badge-tipo badge-' + tipo + '">' + escapeHtml(tipoLabel(tipo)) + "</span>";
    var tags = "";
    if (article.comune) {
      var comune = findComune(article.comune);
      var nome = comune ? comune.nome : article.comune;
      tags +=
        '<a class="tag" href="' +
        base +
        "comuni/" +
        escapeHtml(article.comune) +
        '.html">' +
        escapeHtml(nome) +
        "</a>";
    }
    if (article.gruppo) {
      tags += '<a class="tag" href="' + base + 'gruppo.html">Gruppo Territoriale</a>';
    }
    return (
      '<div class="meta">' +
      badge +
      etichetta +
      '<time datetime="' +
      escapeHtml(article.data) +
      '">' +
      escapeHtml(formatDate(article.data)) +
      "</time>" +
      tags +
      "</div>"
    );
  }

  function cardHtml(article, base, heading) {
    var tag = heading || "h3";
    return (
      "<article class=\"card\">" +
      imageHtml(article) +
      metaHtml(article, base) +
      "<" + tag + "><a href=\"" +
      base +
      "articolo.html?id=" +
      encodeURIComponent(article.id) +
      "\">" +
      escapeHtml(article.titolo) +
      "</a></" + tag + ">" +
      "<p class=\"excerpt\">" +
      escapeHtml(article.estratto) +
      "</p>" +
      "</article>"
    );
  }

  function featuredHtml(article, base) {
    return (
      '<article class="featured">' +
      '<p class="page-kicker">Ultimo articolo</p>' +
      imageHtml(article) +
      metaHtml(article, base) +
      "<h2>" +
      escapeHtml(article.titolo) +
      "</h2>" +
      "<p class=\"excerpt\">" +
      escapeHtml(article.estratto) +
      "</p>" +
      '<a class="leggi-tutto" href="' +
      base +
      "articolo.html?id=" +
      encodeURIComponent(article.id) +
      '">' +
      (article.tipo === "comunicato" ? "Leggi il comunicato" : "Leggi l'articolo") +
      "</a>" +
      "</article>"
    );
  }

  /* Per mostrare un altro social basta compilare url e mettere visibile: true. */
  var SOCIAL = [
    {
      id: "facebook",
      nome: "Facebook",
      url: "https://www.facebook.com/M5SSezze/",
      visibile: true,
      aria: "Pagina Facebook del gruppo"
    },
    { id: "instagram", nome: "Instagram", url: "", visibile: false, aria: "Profilo Instagram del gruppo" },
    { id: "tiktok", nome: "TikTok", url: "", visibile: false, aria: "Profilo TikTok del gruppo" },
    { id: "youtube", nome: "YouTube", url: "", visibile: false, aria: "Canale YouTube del gruppo" }
  ];

  var ALBO_PULSANTE_UFFICIALE = {
    "cisterna-di-latina": true,
    norma: true,
    sezze: true,
    priverno: true,
    fondi: true,
    "monte-san-biagio": true,
    "roccasecca-dei-volsci": true,
    lenola: true,
    sermoneta: true,
    terracina: true,
    "rocca-massima": true,
    ceccano: true
  };

  function socialVisibili() {
    return SOCIAL.filter(function (item) {
      return item.visibile && item.url;
    });
  }

  function iconaSocial(id) {
    if (id === "facebook") {
      return '<svg class="icon-social" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M14.2 8.5V6.9c0-.7.4-1 1.1-1H17V3.2h-2.2C12.1 3.2 11 4.6 11 6.7v1.8H9v2.7h2V21h3.4v-9.8h2.2l.4-2.7h-2.8z"/></svg>';
    }
    if (id === "instagram") {
      return '<svg class="icon-social" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 3h8a5 5 0 0 1 5 5v8a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V8a5 5 0 0 1 5-5zm8 2H8a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3V8a3 3 0 0 0-3-3zm-4 3.2A3.8 3.8 0 1 1 8.2 12 3.8 3.8 0 0 1 12 8.2zm0 2A1.8 1.8 0 1 0 13.8 12 1.8 1.8 0 0 0 12 10.2zM17.2 6.6a1 1 0 1 1-1 1 1 1 0 0 1 1-1z"/></svg>';
    }
    if (id === "tiktok") {
      return '<svg class="icon-social" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M14 3h2.2a4.8 4.8 0 0 0 3.3 3.1V8.4a7 7 0 0 1-3.3-1v6.7a5.6 5.6 0 1 1-5.6-5.6c.3 0 .6 0 .9.1v2.4a3.2 3.2 0 1 0 2.3 3.1V3z"/></svg>';
    }
    if (id === "youtube") {
      return '<svg class="icon-social" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M22 12.2s0-3.2-.4-4.6a3 3 0 0 0-2.1-2.1C17.9 5 12 5 12 5s-5.9 0-7.5.5a3 3 0 0 0-2.1 2.1C2 9 2 12.2 2 12.2s0 3.2.4 4.6a3 3 0 0 0 2.1 2.1C6.1 19.4 12 19.4 12 19.4s5.9 0 7.5-.5a3 3 0 0 0 2.1-2.1c.4-1.4.4-4.6.4-4.6zM10 15.5v-6.6l5.2 3.3z"/></svg>';
    }
    return "";
  }

  function linkSocial(item, extraClass) {
    return (
      '<a class="' +
      (extraClass || "social-link") +
      '" href="' +
      escapeHtml(item.url) +
      '" target="_blank" rel="noopener noreferrer" aria-label="' +
      escapeHtml(item.aria || item.nome) +
      '">' +
      iconaSocial(item.id) +
      "<span>" +
      escapeHtml(item.nome) +
      "</span></a>"
    );
  }

  function renderHeader() {
    var mount = $("#site-header");
    if (!mount) return;
    var base = basePath();
    var icone = socialVisibili()
      .map(function (item) {
        return linkSocial(item, "social-icon");
      })
      .join("");
    mount.innerHTML =
      '<a class="skip-link" href="#contenuto">Salta al contenuto</a>' +
      '<div class="header-inner">' +
      '<img class="logo" src="' + base + 'img/logo.png" alt="Logo Movimento 5 Stelle" width="64" height="64">' +
      '<div class="brand">' +
      '<p class="brand-name"><a href="' +
      base +
      'index.html">GT Lepini Ausoni</a></p>' +
      '<p class="brand-sub">Movimento 5 Stelle</p>' +
      "</div>" +
      '<div class="header-tools">' +
      icone +
      '<a class="btn-iscriviti" href="https://portale.movimento5stelle.eu/iscrizioni" target="_blank" rel="noopener noreferrer">Iscriviti al Movimento 5 Stelle</a>' +
      "</div></div>";
  }

  function renderNav(currentSlug) {
    var mount = $("#site-nav");
    if (!mount) return;
    var base = basePath();
    var path = window.location.pathname || "";
    var isHome = /index\.html$/.test(path) || (/\/$/.test(path) && path.indexOf("/comuni/") === -1);
    var isRassegna = /rassegna\.html$/.test(path);
    var isGruppo = /gruppo\.html$/.test(path);

    var comuni = "";
    DATA.comuni.forEach(function (c) {
      var current = currentSlug === c.slug ? ' aria-current="page"' : "";
      comuni +=
        "<li><a href=\"" +
        base +
        "comuni/" +
        c.slug +
        '.html"' +
        current +
        ">" +
        escapeHtml(c.nome) +
        "</a></li>";
    });

    var extra = "";
    socialVisibili().forEach(function (item) {
      extra += '<li class="menu-social">' + linkSocial(item, "social-link") + "</li>";
    });
    extra += '<li class="menu-iscriviti"><a href="https://portale.movimento5stelle.eu/iscrizioni" target="_blank" rel="noopener noreferrer">Iscriviti al M5S ↗</a></li>';

    mount.innerHTML =
      '<div class="nav-inner">' +
      '<button type="button" class="nav-toggle" aria-expanded="false" aria-controls="menu-principale">' +
      '<span class="nav-toggle-bars" aria-hidden="true"></span> Menu' +
      "</button>" +
      '<ul class="menu" id="menu-principale">' +
      '<li><a href="' +
      base +
      'index.html"' +
      (isHome && !currentSlug ? ' aria-current="page"' : "") +
      ">Home</a></li>" +
      '<li><a href="' +
      base +
      'rassegna.html"' +
      (isRassegna ? ' aria-current="page"' : "") +
      ">Rassegna stampa</a></li>" +
      '<li><a href="' +
      base +
      'gruppo.html"' +
      (isGruppo ? ' aria-current="page"' : "") +
      ">Gruppo Territoriale</a></li>" +
      '<li class="voce-comuni">' +
      '<button type="button" class="comuni-toggle" aria-expanded="false" aria-controls="elenco-comuni">Comuni</button>' +
      '<ul class="elenco-comuni" id="elenco-comuni" hidden>' +
      comuni +
      "</ul></li>" +
      extra +
      "</ul></div>";

    var toggle = $(".nav-toggle", mount);
    var menu = $("#menu-principale", mount);
    if (toggle && menu) {
      toggle.addEventListener("click", function () {
        var open = menu.classList.toggle("is-open");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
      });
    }
    var comuniBtn = $(".comuni-toggle", mount);
    var elenco = $("#elenco-comuni", mount);
    if (comuniBtn && elenco) {
      comuniBtn.addEventListener("click", function () {
        var open = elenco.hasAttribute("hidden");
        if (open) elenco.removeAttribute("hidden");
        else elenco.setAttribute("hidden", "");
        elenco.classList.toggle("is-open", open);
        comuniBtn.setAttribute("aria-expanded", open ? "true" : "false");
      });
      document.addEventListener("click", function (ev) {
        if (!mount.contains(ev.target) && !elenco.hasAttribute("hidden")) {
          elenco.setAttribute("hidden", "");
          elenco.classList.remove("is-open");
          comuniBtn.setAttribute("aria-expanded", "false");
        }
      });
      document.addEventListener("keydown", function (ev) {
        if (ev.key === "Escape" && !elenco.hasAttribute("hidden")) {
          elenco.setAttribute("hidden", "");
          elenco.classList.remove("is-open");
          comuniBtn.setAttribute("aria-expanded", "false");
          comuniBtn.focus();
        }
      });
    }
  }

  function renderFooter() {
    var mount = $("#site-footer");
    if (!mount) return;
    mount.innerHTML =
      '<div class="footer-inner">' +
      '<div>' +
      "<h2>Contatti</h2>" +
      '<ul class="contatti">' +
      "<li>Gruppo Territoriale Lepini Ausoni</li>" +
      "<li>Provincia di Latina, Lazio</li>" +
      '<li><a href="mailto:info@esempio.it">info@esempio.it</a> <span class="badge-esempio">segnaposto</span></li>' +
      "</ul>" +
      '<p>' + '<a class="btn-iscriviti" href="https://portale.movimento5stelle.eu/iscrizioni" target="_blank" rel="noopener noreferrer">Iscriviti al Movimento 5 Stelle</a>' + '</p>' +
      "</div>" +
      "<div>" +
      "<h2>Social</h2>" +
      '<ul class="social-list">' +
      socialVisibili()
        .map(function (item) {
          return "<li>" + linkSocial(item, "social-link") + "</li>";
        })
        .join("") +
      "</ul></div>" +
      '<div class="newsletter">' +
      "<h2>Iscriviti alla newsletter</h2>" +
      '<form id="form-newsletter" action="#" method="post">' +
      '<label for="email-newsletter">Indirizzo e-mail</label>' +
      '<input id="email-newsletter" name="email" type="email" autocomplete="email" placeholder="esempio@email.it" required>' +
      '<label class="check">' +
      '<input id="consenso-gdpr" name="consenso" type="checkbox" required>' +
      "<span>Acconsento al trattamento dei miei dati personali per l'invio della newsletter, ai sensi del Regolamento (UE) 2016/679 (GDPR). Potrò disiscrivermi in qualsiasi momento tramite il collegamento presente in ogni messaggio.</span>" +
      "</label>" +
      '<button type="submit">Iscriviti</button>' +
      '<p class="newsletter-msg" id="newsletter-msg" hidden></p>' +
      "</form></div></div>" +
      '<p class="copyright">© Movimento 5 Stelle – Gruppo Territoriale Lepini Ausoni.</p>';

    var form = $("#form-newsletter", mount);
    if (form) {
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var msg = $("#newsletter-msg", mount);
        if (msg) {
          msg.hidden = false;
          msg.textContent =
            "Il modulo non è ancora attivo: questa è soltanto una prova di iscrizione. Nessun dato è stato inviato.";
        }
      });
    }
  }

  var MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

  function datiRassegna() {
    return window.M5S_RASSEGNA || { notizie: [], fonti: [] };
  }

  function dataItaliana(iso) {
    var parti = String(iso || "").split("-");
    if (parti.length < 3) return "";
    return Number(parti[2]) + " " + (MESI[Number(parti[1]) - 1] || "") + " " + parti[0];
  }

  function nomeComune(slug) {
    var trovato = (DATA.comuni || []).filter(function (c) { return c.slug === slug; })[0];
    return trovato ? trovato.nome : slug;
  }

  function notizieOrdinate(slug) {
    var lista = (datiRassegna().notizie || []).slice();
    if (slug && slug !== "tutti") {
      lista = lista.filter(function (n) {
        return (n.comuni || []).indexOf(slug) !== -1;
      });
    }
    lista.sort(function (a, b) {
      return String(b.data || "").localeCompare(String(a.data || ""));
    });
    return lista;
  }

  function cardNotizia(n, base) {
    var logo = n.logo ? '<img src="' + base + escapeHtml(n.logo) + '" alt="" width="28" height="28">' : "";
    var quando = dataItaliana(n.data);
    var anteprima = n.anteprima
      ? '<p class="notizia-anteprima">' + escapeHtml(n.anteprima) + "</p>"
      : "";
    var comuni = (n.comuni || []).map(nomeComune).join(", ");
    return (
      '<article class="card notizia">' +
      '<p class="notizia-testata">' +
      logo +
      "<span>" + escapeHtml(n.testataNome || "") + "</span>" +
      (quando ? "<time datetime=\"" + escapeHtml(n.data) + "\">" + escapeHtml(quando) + "</time>" : "") +
      "</p>" +
      "<h3><a href=\"" + escapeHtml(n.url) + "\" target=\"_blank\" rel=\"noopener noreferrer\">" + escapeHtml(n.titolo) + "</a></h3>" +
      anteprima +
      '<p class="notizia-leggi"><a href="' + escapeHtml(n.url) + '" target="_blank" rel="noopener noreferrer">Leggi l\'articolo completo su ' + escapeHtml(n.testataNome || "la testata") + "</a></p>" +
      (comuni ? '<p class="notizia-comuni">Cita: ' + escapeHtml(comuni) + "</p>" : "") +
      "</article>"
    );
  }

  function renderRassegnaComune(slug, base, nome) {
    var lista = notizieOrdinate(slug).slice(0, 5);
    var html = '<section class="rassegna-box" aria-labelledby="rassegna-comune-title">';
    html += '<h2 id="rassegna-comune-title">Dalla stampa locale</h2>';
    if (!lista.length) {
      html += '<p class="vuoto">Nessuna notizia recente delle testate locali cita ' + escapeHtml(nome) + ".</p>";
    } else {
      html += '<div class="lista-articoli">';
      lista.forEach(function (n) { html += cardNotizia(n, base); });
      html += "</div>";
      html += '<p class="rassegna-altre"><a href="' + base + "rassegna.html#" + encodeURIComponent(slug) + '">Tutte le notizie su ' + escapeHtml(nome) + "</a></p>";
    }
    html += "</section>";
    return html;
  }

  function renderRassegna() {
    var mount = $("#contenuto");
    if (!mount) return;
    var base = basePath();
    var dati = datiRassegna();
    var slug = (window.location.hash || "").replace(/^#/, "") || "tutti";
    if (slug !== "tutti" && !(DATA.comuni || []).some(function (c) { return c.slug === slug; })) slug = "tutti";

    var filtri = '<div class="filtri-comune" role="group" aria-label="Filtra per comune">';
    filtri += '<a class="filtro' + (slug === "tutti" ? " is-active" : "") + '" href="' + base + 'rassegna.html#tutti">Tutti</a>';
    (DATA.comuni || []).forEach(function (c) {
      filtri += '<a class="filtro' + (slug === c.slug ? " is-active" : "") + '" href="' + base + "rassegna.html#" + encodeURIComponent(c.slug) + '">' + escapeHtml(c.nome) + "</a>";
    });
    filtri += "</div>";

    var lista = notizieOrdinate(slug);
    var html =
      "<h1>Rassegna stampa</h1>" +
      '<p class="lead">Notizie delle testate locali che citano i comuni del Gruppo Territoriale. Di ogni articolo si mostra il titolo originale e un breve riassunto già pubblicato dalla testata nel proprio feed RSS, al massimo tre righe. Il testo completo resta sul sito del giornale.</p>';
    if (dati.aggiornato) {
      html += '<p class="rassegna-aggiornata">Ultimo aggiornamento: ' + escapeHtml(dati.aggiornato.replace("T", " ").slice(0, 16)) + "</p>";
    }
    var fontiKo = (dati.fonti || []).filter(function (f) { return f.esito && f.esito !== "ok"; });
    if (fontiKo.length) {
      html += '<p class="rassegna-aggiornata">Fonte non raggiungibile: ' + escapeHtml(fontiKo.map(function (f) { return f.nome; }).join(", ")) + ".</p>";
    }
    html += filtri;
    if (!lista.length) {
      html += '<p class="vuoto">In questo momento non ci sono notizie da mostrare per questa selezione.</p>';
    } else {
      html += '<div class="lista-articoli">';
      lista.forEach(function (n) { html += cardNotizia(n, base); });
      html += "</div>";
    }
    mount.innerHTML = html;
    if (!mount.getAttribute("data-rassegna-hash")) {
      mount.setAttribute("data-rassegna-hash", "1");
      window.addEventListener("hashchange", renderRassegna);
    }
  }

  function renderGruppo() {
    var mount = $("#contenuto");
    if (!mount) return;
    var base = basePath();
    document.title = "Gruppo Territoriale – Movimento 5 Stelle, GT Lepini Ausoni";
    var tipo = (window.location.hash || "").replace(/^#/, "") || "tutti";
    if (tipo !== "articolo" && tipo !== "comunicato" && tipo !== "nazionale" && tipo !== "regionale") tipo = "tutti";
    var articoliTutti = articlesGruppo("tutti");
    var vociTutte = vociUfficiali("tutti");
    var pezzi = [];
    if (tipo === "tutti" || tipo === "articolo" || tipo === "comunicato") {
      articlesGruppo(tipo).forEach(function (a) {
        pezzi.push({ data: a.data || "", html: cardHtml(a, base) });
      });
    }
    if (tipo === "tutti" || tipo === "nazionale" || tipo === "regionale") {
      vociUfficiali(tipo === "tutti" ? "tutti" : tipo).forEach(function (v) {
        pezzi.push({ data: v.data || "", html: cardVoce(v, base) });
      });
    }
    pezzi.sort(function (a, b) { return String(b.data).localeCompare(String(a.data)); });

    var html =
      '<p class="page-kicker">Movimento 5 Stelle</p>' +
      "<h1>Gruppo Territoriale</h1>" +
      '<p class="lead">Articoli e comunicati del Gruppo Territoriale Lepini Ausoni, insieme alle notizie ufficiali del Movimento nazionale e del Movimento in Lazio. Di quelle si mostra solo il riassunto già pubblicato nel feed, con il link alla fonte.</p>';

    html += '<div class="filtri-comune" role="group" aria-label="Filtra per tipo">';
    html += '<a class="filtro' + (tipo === "tutti" ? " is-active" : "") + '" href="' + base + 'gruppo.html#tutti">Tutti</a>';
    html += '<a class="filtro' + (tipo === "articolo" ? " is-active" : "") + '" href="' + base + 'gruppo.html#articolo">Articoli</a>';
    html += '<a class="filtro' + (tipo === "comunicato" ? " is-active" : "") + '" href="' + base + 'gruppo.html#comunicato">Comunicati stampa</a>';
    html += '<a class="filtro' + (tipo === "nazionale" ? " is-active" : "") + '" href="' + base + 'gruppo.html#nazionale">Dal Nazionale</a>';
    html += '<a class="filtro' + (tipo === "regionale" ? " is-active" : "") + '" href="' + base + 'gruppo.html#regionale">Dal Regionale</a>';
    html += "</div>";
    html += riquadriFacebook(tipo);

    if (!articoliTutti.length && !vociTutte.length) {
      html += '<p class="vuoto">Presto i primi comunicati del gruppo.</p>';
    } else if (!pezzi.length) {
      html += '<p class="vuoto">Non ci sono ancora contenuti di questo tipo.</p>';
    } else {
      html += '<div class="lista-articoli">';
      pezzi.forEach(function (p) { html += p.html; });
      html += "</div>";
    }
    mount.innerHTML = html;
    if (!mount.getAttribute("data-gruppo-hash")) {
      mount.setAttribute("data-gruppo-hash", "1");
      window.addEventListener("hashchange", renderGruppo);
    }
    attivaRiquadriFacebook();
  }

  var PAGINE_FB = [
    {
      id: "nazionale",
      nome: "MoVimento 5 Stelle",
      url: "https://www.facebook.com/movimento5stelle/"
    },
    {
      id: "regionale",
      nome: "MoVimento 5 Stelle Lazio",
      url: "https://www.facebook.com/lazio5stelle/"
    }
  ];

  function riquadroFacebook(pagina) {
    return (
      '<section class="fb-riquadro">' +
      "<h2>" + escapeHtml(pagina.nome) + "</h2>" +
      '<div class="fb-page" data-href="' + escapeHtml(pagina.url) + '" data-tabs="timeline" data-width="500" data-height="520" data-small-header="true" data-adapt-container-width="true" data-hide-cover="false" data-show-facepile="false" data-lazy="true">' +
      '<blockquote class="fb-fallback" cite="' + escapeHtml(pagina.url) + '">' +
      '<a href="' + escapeHtml(pagina.url) + '" target="_blank" rel="noopener noreferrer">Apri la pagina Facebook di ' + escapeHtml(pagina.nome) + "</a>" +
      "</blockquote></div></section>"
    );
  }

  function riquadriFacebook(tipo) {
    var pagine = PAGINE_FB.filter(function (p) {
      return tipo === "tutti" || tipo === p.id;
    });
    if (!pagine.length) return "";
    var html = '<div class="fb-riquadri' + (pagine.length > 1 ? " due" : "") + '">';
    pagine.forEach(function (p) { html += riquadroFacebook(p); });
    html += "</div>";
    return html;
  }

  function attivaRiquadriFacebook() {
    if (!document.querySelector(".fb-page")) return;
    if (window.FB && window.FB.XFBML) {
      window.FB.XFBML.parse();
      return;
    }
    if (document.getElementById("facebook-jssdk")) return;
    var js = document.createElement("script");
    js.id = "facebook-jssdk";
    js.async = true;
    js.defer = true;
    js.crossOrigin = "anonymous";
    js.src = "https://connect.facebook.net/it_IT/sdk.js#xfbml=1&version=v21.0";
    document.body.appendChild(js);
  }

  function renderHome() {
    var mount = $("#contenuto");
    if (!mount) return;
    var base = basePath();
    var all = sortedArticles().map(function (a) {
      return { data: a.data || "", id: "a-" + a.id, article: a };
    });
    vociUfficiali("tutti").forEach(function (v) {
      all.push({ data: v.data || "", id: "v-" + v.url, voce: v });
    });
    all.sort(function (a, b) {
      if (a.data === b.data) return a.id < b.id ? 1 : -1;
      return a.data < b.data ? 1 : -1;
    });
    var latest = all[0];
    var recent = all.slice(1);

    var html =
      '<p class="page-kicker">Provincia di Latina, Lazio</p>' +
      '<h1 class="page-title">Gruppo Territoriale Lepini Ausoni</h1>' +
      '<p class="lead">Aggiornamenti dal territorio e, per ciascun comune, gli articoli e gli atti recenti dell\'albo pretorio. Gli articoli contrassegnati come esempio sono testi di prova.</p>';

    if (latest && latest.voce) {
      html += featuredVoce(latest.voce, base);
    } else if (latest && latest.article) {
      html += featuredHtml(latest.article, base);
    } else {
      html += '<p class="vuoto">Non ci sono ancora articoli pubblicati.</p>';
    }

    html += "<h2 class=\"section-title\">Ultime notizie</h2>";
    if (recent.length) {
      html += '<div class="lista-articoli">';
      recent.forEach(function (item) {
        html += item.voce ? cardVoce(item.voce, base) : cardHtml(item.article, base);
      });
      html += "</div>";
    } else {
      html += '<p class="vuoto">Non ci sono altre notizie al momento.</p>';
    }

    mount.innerHTML = html;
  }

  function renderComune(slug) {
    var mount = $("#contenuto");
    if (!mount) return;
    var base = basePath();
    var comune = findComune(slug);
    if (!comune) {
      mount.innerHTML =
        '<h1 class="page-title">Comune non trovato</h1>' +
        '<p><a href="' +
        base +
        'index.html">Torna alla homepage</a></p>';
      document.title = "Comune non trovato – GT Lepini Ausoni";
      return;
    }

    document.title =
      comune.nome + " – Movimento 5 Stelle, GT Lepini Ausoni";

    var list = articlesByComune(slug);
    var html =
      '<p class="page-kicker">Gruppo Territoriale Lepini Ausoni</p>' +
      '<h1 class="page-title">' +
      escapeHtml(comune.nome) +
      "</h1>" +
      "<h2 class=\"section-title\">Articoli e aggiornamenti</h2>";

    if (list.length) {
      html += '<div class="lista-articoli">';
      list.forEach(function (a) {
        html += cardHtml(a, base);
      });
      html += "</div>";
    } else {
      html +=
        '<p class="vuoto">Non ci sono ancora articoli pubblicati per ' +
        escapeHtml(comune.nome) +
        ". Qui verranno raccolti gli aggiornamenti che riguardano questo comune.</p>";
    }

    html += renderRassegnaComune(slug, base, comune.nome);
    html += '<section class="albo-box" aria-labelledby="albo-title">';
    html += '<h2 id="albo-title">Albo pretorio</h2>';

    if (comune.alboAutomatico === false && !comune.alboUrl) {
      html +=
        "<p>Qui saranno raccolti gli aggiornamenti che riguardano il Comune di " +
        escapeHtml(comune.nome) +
        ". Il collegamento all'albo pretorio online e l'elenco automatico degli atti saranno aggiunti quando l'indirizzo ufficiale sarà confermato.</p>";
      html += "</section>";
      mount.innerHTML = html;
      return;
    }

    if (comune.alboVerificato) {
      html +=
        "<p>Consulta l'albo pretorio online ufficiale del Comune di " +
        escapeHtml(comune.nome) +
        ". Il collegamento apre il sito istituzionale in una nuova scheda.</p>";
      if (ALBO_PULSANTE_UFFICIALE[slug] && comune.alboUrl) {
        html +=
          '<a class="btn-albo-ufficiale" href="' +
          escapeHtml(comune.alboUrl) +
          '" target="_blank" rel="noopener noreferrer">Vai all\'albo ufficiale</a>';
        if (comune.alboAutomatico === false) {
          html +=
            '<p class="nota-albo">L\'elenco automatico degli atti non è ancora attivo per questo comune. L\'albo ufficiale resta raggiungibile dal pulsante.</p>';
        } else {
          html +=
            '<p class="nota-albo">L\'elenco automatico qui sotto può non essere completo. L\'albo ufficiale del Comune resta sempre raggiungibile dal pulsante.</p>';
        }
      }
      html +=
        '<a class="btn-esterno" href="' +
        escapeHtml(comune.alboUrl) +
        '" target="_blank" rel="noopener noreferrer">Apri l\'albo pretorio del Comune di ' +
        escapeHtml(comune.nome) +
        "</a>";
    } else {
      html +=
        "<p>Il collegamento diretto all'albo pretorio online non è stato verificato al momento della pubblicazione di questo prototipo. Trovi il sito istituzionale del Comune di " +
        escapeHtml(comune.nome) +
        ", da cui è possibile raggiungere l'albo pretorio.</p>";
      html +=
        '<a class="btn-esterno" href="' +
        escapeHtml(comune.sitoIstituzionale) +
        '" target="_blank" rel="noopener noreferrer">Vai al sito del Comune di ' +
        escapeHtml(comune.nome) +
        "</a>";
      html +=
        '<p class="nota-albo">Se l\'indirizzo dell\'albo ufficiale verrà confermato, lo inseriremo direttamente in questa sezione.</p>';
    }

    if (comune.alboAutomatico !== false) html += renderAlboElenco(slug);
    html += "</section>";
    mount.innerHTML = html;
  }

  function formatStamp(iso) {
    var match = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    if (!match) return iso || "";
    return match[3] + "/" + match[2] + "/" + match[1] + " alle " + match[4] + ":" + match[5];
  }

  function renderAlboElenco(slug) {
    var root = window.M5S_ALBO;
    var info = root && root.comuni ? root.comuni[slug] : null;
    if (!info) {
      return '<p class="albo-stato">Elenco degli atti non ancora aggiornato.</p>';
    }
    var when = formatStamp(info.aggiornato);
    var html = "";
    if (info.ok) {
      html += '<p class="albo-stato">Ultimo aggiornamento: ' + escapeHtml(when) + " (ora di Roma).</p>";
    } else {
      html += '<p class="albo-stato errore">Fonte non raggiungibile. Ultimo tentativo: ' + escapeHtml(when) + ".</p>";
      if (info.errore && info.errore !== "Fonte non raggiungibile") {
        html += '<p class="nota-albo">' + escapeHtml(info.errore) + "</p>";
      }
      if (info.atti && info.atti.length) {
        html += '<p class="nota-albo">Sono mostrati gli atti dell\'ultimo aggiornamento riuscito.</p>';
      }
    }
    var atti = info.atti || [];
    if (!atti.length) {
      html += '<p class="vuoto">Nessun atto in elenco.</p>';
      return html;
    }
    html += '<h3 class="albo-sottotitolo">Atti recenti</h3><ul class="albo-atti">';
    atti.forEach(function (item) {
      html += '<li class="albo-atto"><div class="meta">';
      if (item.data) {
        html += '<time datetime="' + escapeHtml(item.data) + '">' + escapeHtml(formatDate(item.data)) + "</time>";
      }
      if (item.tipo) html += '<span class="tag">' + escapeHtml(item.tipo) + "</span>";
      if (item.storico) html += '<span class="badge-storico">Storico</span>';
      if (item.numero) html += "<span>n. " + escapeHtml(item.numero) + "</span>";
      html += "</div><h3>";
      if (item.url) {
        html += '<a href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(item.titolo) + "</a>";
      } else {
        html += escapeHtml(item.titolo);
      }
      html += "</h3></li>";
    });
    html += "</ul>";
    return html;
  }

  function condividiFacebook() {
    var facebook = null;
    for (var i = 0; i < SOCIAL.length; i++) {
      if (SOCIAL[i].id === "facebook" && SOCIAL[i].visibile) facebook = SOCIAL[i];
    }
    if (!facebook) return "";
    var pagina = window.location.href.split("#")[0];
    var href =
      "https://www.facebook.com/sharer/sharer.php?u=" + encodeURIComponent(pagina);
    return (
      '<p class="condividi"><a class="btn-condividi" href="' +
      escapeHtml(href) +
      '" target="_blank" rel="noopener noreferrer">' +
      iconaSocial("facebook") +
      "<span>Condividi su Facebook</span></a></p>"
    );
  }

  function renderArticolo() {
    var mount = $("#contenuto");
    if (!mount) return;
    var base = basePath();
    var params = new URLSearchParams(window.location.search);
    var id = params.get("id");
    var article = id ? findArticle(id) : null;

    if (!article) {
      document.title = "Articolo non trovato – GT Lepini Ausoni";
      mount.innerHTML =
        '<h1 class="page-title">Articolo non trovato</h1>' +
        "<p>L'articolo richiesto non è presente, oppure il collegamento non è corretto.</p>" +
        '<p><a class="back-link" href="' +
        base +
        'index.html">Torna alla homepage</a></p>';
      return;
    }

    document.title =
      article.titolo + " – Movimento 5 Stelle, GT Lepini Ausoni";

    mount.innerHTML =
      '<article class="articolo-corpo">' +
      metaHtml(article, base) +
      "<h1>" +
      escapeHtml(article.titolo) +
      "</h1>" +
      imageHtml(article) +
      renderMarkdown(article.testo) +
      condividiFacebook() +
      "</article>" +
      "<p>" +
      '<a class="back-link" href="' +
      base +
      'index.html">← Torna alla homepage</a>' +
      (article.gruppo
        ? ' <a class="back-link" href="' + base + 'gruppo.html">← Gruppo Territoriale</a>'
        : "") +
      "</p>";
  }


  var WA_URL = "https://whatsapp.com/channel/0029VbE0ZtaLdQebTYmIT409";
  var WA_CAP = "Il canale garantisce l'anonimato dei membri e non fa vedere il numero di telefono (neanche agli amministratori)";
  function renderWhatsApp() {
    var base = basePath();
    var box = document.createElement("aside");
    box.className = "wa-box";
    box.setAttribute("aria-label", "Canale WhatsApp");
    box.innerHTML =
      '<a class="wa-qr" href="' + WA_URL + '" target="_blank" rel="noopener noreferrer"><img src="' + base + 'img/qr-whatsapp-card.png" alt="QR code del canale WhatsApp GT M5S Lepini Ausoni" width="400" height="391"></a>' +
      '<a class="wa-btn" href="' + WA_URL + '" target="_blank" rel="noopener noreferrer">Iscriviti al canale WhatsApp</a>' +
      '<p class="wa-cap">' + WA_CAP + '</p>' +
      '<button type="button" class="wa-close" aria-label="Chiudi QR">×</button>';
    var bar = document.createElement("div");
    bar.className = "wa-bar";
    bar.innerHTML =
      '<a class="wa-btn" href="' + WA_URL + '" target="_blank" rel="noopener noreferrer">Iscriviti al canale WhatsApp</a>' +
      '<button type="button" class="wa-qr-toggle" aria-expanded="false">QR</button>' +
      '<p class="wa-cap">' + WA_CAP + '</p>';
    document.body.appendChild(box);
    document.body.appendChild(bar);
    var t = bar.querySelector(".wa-qr-toggle");
    t.addEventListener("click", function () {
      var o = box.classList.toggle("is-open");
      t.setAttribute("aria-expanded", o ? "true" : "false");
    });
    box.querySelector(".wa-close").addEventListener("click", function () {
      box.classList.remove("is-open"); t.setAttribute("aria-expanded", "false");
    });
  }

  function init() {
    var page = document.body.getAttribute("data-page") || "";
    var slug = document.body.getAttribute("data-comune") || "";
    renderHeader();
    renderNav(slug || null);
    renderFooter();
    renderWhatsApp();

    if (page === "home") renderHome();
    else if (page === "comune") renderComune(slug);
    else if (page === "articolo") renderArticolo();
    else if (page === "rassegna") renderRassegna();
    else if (page === "gruppo") renderGruppo();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
