"use strict";
(() => {
  // static/src/landing.ts
  (function() {
    "use strict";
    const doc = document.documentElement;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const w = window;
    if (!w.gsap || !w.ScrollTrigger || reduce) {
      doc.classList.remove("has-gsap");
      document.querySelectorAll("[data-pan]").forEach((el) => {
        el.classList.add("pan-static");
      });
      window.__landingReady = true;
      bindCta(false);
      return;
    }
    const g = w.gsap;
    const ST = w.ScrollTrigger;
    g.registerPlugin(ST);
    g.defaults({ ease: "power3.out", duration: 0.7 });
    function splitChars(root) {
      if (!root)
        return;
      root.querySelectorAll(":scope > span").forEach((line) => {
        const text = Array.from(line.textContent || "");
        line.textContent = "";
        text.forEach((ch) => {
          const span = document.createElement("span");
          span.className = "ch";
          span.style.display = "inline-block";
          span.textContent = ch;
          line.appendChild(span);
        });
      });
    }
    const h1 = document.querySelector("[data-split]");
    if (h1)
      splitChars(h1);
    g.set('[data-anim="cta"]', { autoAlpha: 1 });
    const intro = g.timeline({ delay: 0.05 });
    intro.fromTo('[data-anim="eyebrow"]', { y: 12, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5 }).fromTo(
      h1 ? h1.querySelectorAll(".ch") : [],
      { yPercent: 115, autoAlpha: 0 },
      { yPercent: 0, autoAlpha: 1, duration: 0.75, stagger: 0.028 },
      "-=0.3"
    ).fromTo('[data-anim="sub"]', { y: 16, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.6 }, "-=0.45").fromTo('[data-anim="cta"] > *', { y: 14, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5, stagger: 0.09 }, "-=0.35").fromTo("[data-frame]", { scale: 0.945, rotate: -2.4 }, { scale: 1, rotate: 0, duration: 1.05, ease: "power3.out" }, "-=0.95").fromTo("[data-wipe]", { scaleY: 1 }, { scaleY: 0, duration: 1.1, ease: "power3.inOut" }, "-=1.0");
    g.to("[data-frame]", {
      y: -46,
      ease: "none",
      scrollTrigger: { trigger: "#top", start: "top top", end: "bottom top", scrub: true }
    });
    g.to("#top .halftone", {
      y: 34,
      ease: "none",
      scrollTrigger: { trigger: "#top", start: "top top", end: "bottom top", scrub: true }
    });
    ST.batch(".reveal", {
      start: "top 90%",
      once: true,
      onEnter: function(batch) {
        g.fromTo(
          batch,
          { y: 26, autoAlpha: 0 },
          { y: 0, autoAlpha: 1, duration: 0.75, stagger: 0.08, overwrite: true }
        );
      }
    });
    const closeTitle = document.querySelector('[data-anim="close"]');
    if (closeTitle) {
      g.fromTo(closeTitle, { y: 30, autoAlpha: 0 }, {
        y: 0,
        autoAlpha: 1,
        duration: 0.9,
        scrollTrigger: { trigger: closeTitle, start: "top 88%", once: true }
      });
    }
    const track = document.querySelector("[data-marquee-track]");
    if (track) {
      const clone = track.cloneNode(true);
      clone.setAttribute("aria-hidden", "true");
      Array.prototype.forEach.call(clone.children, (child) => {
        track.appendChild(child);
      });
      const loop = g.to(track, { xPercent: -50, duration: 30, ease: "none", repeat: -1 });
      ST.create({
        trigger: "[data-marquee]",
        start: "top bottom",
        end: "bottom top",
        onToggle: function(self) {
          self.isActive ? loop.play() : loop.pause();
        }
      });
    }
    const mm = g.matchMedia();
    mm.add("(min-width: 768px) and (prefers-reduced-motion: no-preference)", () => {
      const wrap = document.querySelector("[data-pan]");
      const inner = document.querySelector("[data-pan-track]");
      if (!wrap || !inner)
        return;
      const distance = () => Math.max(0, inner.scrollWidth - window.innerWidth);
      if (distance() < 40)
        return;
      const tween = g.to(inner, {
        x: () => -distance(),
        ease: "none",
        scrollTrigger: {
          trigger: wrap,
          start: "top top",
          end: () => "+=" + distance(),
          pin: true,
          scrub: 1,
          invalidateOnRefresh: true
        }
      });
      g.utils.toArray(".pan-card", inner).forEach((card, i) => {
        if (i === 0)
          return;
        g.fromTo(card, { autoAlpha: 0.55, scale: 0.97 }, {
          autoAlpha: 1,
          scale: 1,
          ease: "none",
          scrollTrigger: {
            trigger: card,
            containerAnimation: tween,
            start: "left 92%",
            end: "left 55%",
            scrub: true
          }
        });
      });
      return () => {
      };
    });
    mm.add("(max-width: 767px)", () => {
      const wrap = document.querySelector("[data-pan]");
      if (!wrap)
        return;
      wrap.classList.add("pan-static");
      return () => {
        wrap.classList.remove("pan-static");
      };
    });
    const scan = document.querySelector("[data-scan]");
    if (scan) {
      const scanBox = scan.parentElement;
      if (scanBox) {
        g.fromTo(scan, { y: -10, autoAlpha: 0 }, {
          y: () => scanBox.offsetHeight,
          autoAlpha: 1,
          duration: 1.7,
          ease: "power2.inOut",
          immediateRender: false,
          scrollTrigger: { trigger: scanBox, start: "top 72%", once: true }
        });
      }
    }
    if (canHover) {
      document.querySelectorAll("[data-magnetic]").forEach((btn) => {
        const xTo = g.quickTo(btn, "x", { duration: 0.35, ease: "power3.out" });
        const yTo = g.quickTo(btn, "y", { duration: 0.35, ease: "power3.out" });
        btn.addEventListener("pointermove", (e) => {
          const ev = e;
          const r = btn.getBoundingClientRect();
          xTo(((ev.clientX - r.left) / r.width - 0.5) * 14);
          yTo(((ev.clientY - r.top) / r.height - 0.5) * 10);
        });
        btn.addEventListener("pointerleave", () => {
          xTo(0);
          yTo(0);
        });
      });
    }
    bindCta(true);
    function bindCta(withCurtain) {
      document.querySelectorAll("[data-cta]").forEach((link) => {
        link.addEventListener("click", (e) => {
          const ev = e;
          if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0)
            return;
          if (!withCurtain)
            return;
          ev.preventDefault();
          const panels = document.querySelectorAll("#curtain span");
          const curtain = document.getElementById("curtain");
          const href = link.href;
          if (!panels.length || !curtain) {
            window.location.href = href;
            return;
          }
          curtain.classList.add("on");
          g.timeline({ onComplete: () => {
            window.location.href = href;
          } }).set(panels, { transformOrigin: "bottom" }).to(panels, { scaleY: 1, duration: 0.42, stagger: 0.045, ease: "power3.inOut" });
        });
      });
    }
    window.addEventListener("load", () => {
      ST.refresh();
    });
    window.__landingReady = true;
  })();
})();
//# sourceMappingURL=landing.js.map
