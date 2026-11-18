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

  function findArticle(id) {
    for (var i = 0; i < DATA.articles.length; i++) {
      if (DATA.articles[i].id === id) return DATA.articles[i];
    }
    return null;
  }

  function metaHtml(article, base) {
    var comune = findComune(article.comune);
    var nome = comune ? comune.nome : article.comune;
    var badge = article.esempio
      ? '<span class="badge-esempio">Articolo di esempio</span>'
      : "";
    return (
      '<div class="meta">' +
      badge +
      '<time datetime="' +
      escapeHtml(article.data) +
      '">' +
      escapeHtml(formatDate(article.data)) +
      "</time>" +
      '<a class="tag" href="' +
      base +
      "comuni/" +
      escapeHtml(article.comune) +
      '.html">' +
      escapeHtml(nome) +
      "</a>" +
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
      '">Leggi l\'articolo</a>' +
      "</article>"
    );
  }

  function renderHeader() {
    var mount = $("#site-header");
    if (!mount) return;
    var base = basePath();
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
      '<a class="btn-iscriviti" href="https://portale.movimento5stelle.eu/iscrizioni" target="_blank" rel="noopener noreferrer">Iscriviti al Movimento 5 Stelle</a>' +
      "</div>";
  }

  function renderNav(currentSlug) {
    var mount = $("#site-nav");
    if (!mount) return;
    var base = basePath();
    var path = window.location.pathname || "";
    var isHome = /index\.html$/.test(path) || /\/$/.test(path) && path.indexOf("/comuni/") === -1;

    var items =
      '<li><a href="' +
      base +
      'index.html"' +
      (isHome && !currentSlug ? ' aria-current="page"' : "") +
      ">Home</a></li>";

    DATA.comuni.forEach(function (c) {
      var current = currentSlug === c.slug ? ' aria-current="page"' : "";
      items +=
        '<li><a href="' +
        base +
        "comuni/" +
        c.slug +
        '.html"' +
        current +
        ">" +
        escapeHtml(c.nome) +
        "</a></li>";
    });

    items += '<li class="menu-iscriviti"><a href="https://portale.movimento5stelle.eu/iscrizioni" target="_blank" rel="noopener noreferrer">Iscriviti al M5S ↗</a></li>';
    mount.innerHTML =
      '<div class="nav-inner">' +
      '<button type="button" class="nav-toggle" aria-expanded="false" aria-controls="menu-comuni">' +
      '<span class="nav-toggle-bars" aria-hidden="true"></span> Menu dei comuni' +
      "</button>" +
      '<ul class="menu" id="menu-comuni">' +
      items +
      "</ul></div>";

    var toggle = $(".nav-toggle", mount);
    var menu = $("#menu-comuni", mount);
    if (toggle && menu) {
      toggle.addEventListener("click", function () {
        var open = menu.classList.toggle("is-open");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
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
      '<li><a href="#" aria-disabled="true">Facebook</a> <span class="badge-esempio">segnaposto</span></li>' +
      '<li><a href="#" aria-disabled="true">Instagram</a> <span class="badge-esempio">segnaposto</span></li>' +
      '<li><a href="#" aria-disabled="true">TikTok</a> <span class="badge-esempio">segnaposto</span></li>' +
      '<li><a href="#" aria-disabled="true">YouTube</a> <span class="badge-esempio">segnaposto</span></li>' +
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

  function renderHome() {
    var mount = $("#contenuto");
    if (!mount) return;
    var base = basePath();
    var all = sortedArticles();
    var latest = all[0];
    var recent = all.slice(1);

    var html =
      '<p class="page-kicker">Provincia di Latina, Lazio</p>' +
      '<h1 class="page-title">Gruppo Territoriale Lepini Ausoni</h1>' +
      '<p class="lead">Aggiornamenti dal territorio e, per ciascun comune, gli articoli e gli atti recenti dell\'albo pretorio. Gli articoli contrassegnati come esempio sono testi di prova.</p>';

    if (latest) {
      html += featuredHtml(latest, base);
    } else {
      html += '<p class="vuoto">Non ci sono ancora articoli pubblicati.</p>';
    }

    html += "<h2 class=\"section-title\">Articoli recenti</h2>";
    if (recent.length) {
      html += '<div class="lista-articoli">';
      recent.forEach(function (a) {
        html += cardHtml(a, base);
      });
      html += "</div>";
    } else {
      html += '<p class="vuoto">Non ci sono altri articoli al momento.</p>';
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

    html += '<section class="albo-box" aria-labelledby="albo-title">';
    html += '<h2 id="albo-title">Albo pretorio</h2>';

    if (comune.alboVerificato) {
      html +=
        "<p>Consulta l'albo pretorio online ufficiale del Comune di " +
        escapeHtml(comune.nome) +
        ". Il collegamento apre il sito istituzionale in una nuova scheda.</p>";
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

    html += renderAlboElenco(slug);
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
      "</article>" +
      '<p><a class="back-link" href="' +
      base +
      'index.html">← Torna alla homepage</a></p>';
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
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
