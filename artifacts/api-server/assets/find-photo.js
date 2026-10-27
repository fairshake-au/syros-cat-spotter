// Find from a photo: one tap, one search (SYC-522).
//
// Plain ES2019, no libraries. Comparing a photo takes several seconds and
// each person has only a few searches a day, so a second tap while the first
// is running must not send a second one. On submit this disables the button,
// says the search is running, and ignores any further submit. With no script
// the form is an ordinary POST, as before.
//
// SYC-492: from a report there are two forms, "Use the report's photo" and
// the upload. One search between them: a submit of either locks both.
//
// The page comes back from the server as a new page. If the person returns
// with the back button the browser may restore this page as it was left, so
// "pageshow" puts the button back. If they press Stop or the network drops,
// no page ever arrives, so the button also comes back after 40 seconds (the
// page says a search takes up to half a minute).
(function () {
  "use strict";

  var forms = document.querySelectorAll("form.findphoto");
  var progress = document.getElementById("find-progress");
  if (!forms.length || !progress) return;

  var parts = [];
  for (var i = 0; i < forms.length; i++) {
    var button = forms[i].querySelector("button[type=submit]");
    if (button) parts.push({ form: forms[i], button: button, label: button.textContent });
  }
  var sent = false;

  function reset() {
    sent = false;
    for (var j = 0; j < parts.length; j++) {
      parts[j].button.disabled = false;
      parts[j].button.textContent = parts[j].label;
      parts[j].form.removeAttribute("aria-busy");
    }
    progress.hidden = true;
  }

  parts.forEach(function (part) {
    part.form.addEventListener("submit", function (e) {
      if (sent) {
        e.preventDefault();
        return;
      }
      sent = true;
      for (var j = 0; j < parts.length; j++) parts[j].button.disabled = true;
      part.button.textContent = "Comparing…";
      part.form.setAttribute("aria-busy", "true");
      progress.hidden = false;
      window.setTimeout(reset, 40000);
    });
  });

  window.addEventListener("pageshow", reset);
})();
