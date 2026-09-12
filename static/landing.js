/**
 * 宣传页动效 (GSAP + ScrollTrigger)
 * 每个动画都必须能说清楚它传达什么:
 *   1. 首屏时间轴  → 层级: 先读标题, 再看画面
 *   2. 首屏视差    → 叙事: 画框与网点分层, 滚动时产生纵深
 *   3. 分节入场    → 层级: 内容按段落依次出现, 不抢首屏
 *   4. 跑马灯      → 广度: 八项能力一次扫过 (全页仅此一条)
 *   5. 横向三步    → 叙事: 贴入 → 定角色 → 出整页, 顺序即流程
 *   6. 扫描线      → 叙事: 页面被"读"回文字
 *   7. 磁吸 + 幕布 → 反馈: 主 CTA 跟随指针, 点击后幕布落下再进站
 * 三个前提: 没有 GSAP、系统偏好减少动效、或任何一步抛错时, 内容必须完整可见可点。
 */
(function () {
    var doc = document.documentElement;
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    // ---- 没有 GSAP / 系统要求减少动效: 页面保持静态可用 ----
    if (!window.gsap || !window.ScrollTrigger || reduce) {
        doc.classList.remove('has-gsap');
        // 没有 GSAP 就没有横向位移, 三步必须改成纵向排列, 否则后两张卡片会被裁掉
        document.querySelectorAll('[data-pan]').forEach(function (el) { el.classList.add('pan-static'); });
        window.__landingReady = true;
        bindCta(false);
        return;
    }

    var gsap = window.gsap;
    var ScrollTrigger = window.ScrollTrigger;
    gsap.registerPlugin(ScrollTrigger);
    gsap.defaults({ ease: 'power3.out', duration: 0.7 });

    // ================= 1. 标题逐字 + 首屏时间轴 =================
    function splitChars(root) {
        root.querySelectorAll(':scope > span').forEach(function (line) {
            var text = Array.from(line.textContent);
            line.textContent = '';
            text.forEach(function (ch) {
                var span = document.createElement('span');
                span.className = 'ch';
                span.style.display = 'inline-block';
                span.textContent = ch;
                line.appendChild(span);
            });
        });
    }
    var h1 = document.querySelector('[data-split]');
    if (h1) splitChars(h1);

    // [data-anim="cta"] 是容器, 只动它的子元素, 所以容器本身先解除预隐藏
    gsap.set('[data-anim="cta"]', { autoAlpha: 1 });

    var intro = gsap.timeline({ delay: 0.05 });
    intro
        .fromTo('[data-anim="eyebrow"]', { y: 12, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5 })
        .fromTo(h1 ? h1.querySelectorAll('.ch') : [], { yPercent: 115, autoAlpha: 0 },
            { yPercent: 0, autoAlpha: 1, duration: 0.75, stagger: 0.028 }, '-=0.3')
        .fromTo('[data-anim="sub"]', { y: 16, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.6 }, '-=0.45')
        .fromTo('[data-anim="cta"] > *', { y: 14, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5, stagger: 0.09 }, '-=0.35')
        // 画框只做变换, 不做透明度: 首屏主图必须立刻参与绘制 (LCP)
        .fromTo('[data-frame]', { scale: 0.945, rotate: -2.4 }, { scale: 1, rotate: 0, duration: 1.05, ease: 'power3.out' }, '-=0.95')
        // 墨迹从下往上退开, 像刚印出来
        .fromTo('[data-wipe]', { scaleY: 1 }, { scaleY: 0, duration: 1.1, ease: 'power3.inOut' }, '-=1.0');

    // ================= 2. 首屏视差 =================
    gsap.to('[data-frame]', {
        y: -46, ease: 'none',
        scrollTrigger: { trigger: '#top', start: 'top top', end: 'bottom top', scrub: true }
    });
    gsap.to('#top .halftone', {
        y: 34, ease: 'none',
        scrollTrigger: { trigger: '#top', start: 'top top', end: 'bottom top', scrub: true }
    });

    // ================= 3. 分节入场 =================
    ScrollTrigger.batch('.reveal', {
        start: 'top 90%',
        once: true,
        onEnter: function (batch) {
            gsap.fromTo(batch, { y: 26, autoAlpha: 0 },
                { y: 0, autoAlpha: 1, duration: 0.75, stagger: 0.08, overwrite: true });
        }
    });
    var closeTitle = document.querySelector('[data-anim="close"]');
    if (closeTitle) {
        gsap.fromTo(closeTitle, { y: 30, autoAlpha: 0 }, {
            y: 0, autoAlpha: 1, duration: 0.9,
            scrollTrigger: { trigger: closeTitle, start: 'top 88%', once: true }
        });
    }

    // ================= 4. 跑马灯 (内容复制一份实现无缝循环) =================
    var track = document.querySelector('[data-marquee-track]');
    if (track) {
        var clone = track.cloneNode(true);
        clone.setAttribute('aria-hidden', 'true');
        Array.prototype.forEach.call(clone.children, function (child) { track.appendChild(child); });
        var loop = gsap.to(track, { xPercent: -50, duration: 30, ease: 'none', repeat: -1 });
        // 离开视口时暂停, 不在屏幕外烧帧
        ScrollTrigger.create({
            trigger: '[data-marquee]',
            start: 'top bottom',
            end: 'bottom top',
            onToggle: function (self) { self.isActive ? loop.play() : loop.pause(); }
        });
    }

    // ================= 5. 横向三步 (规范骨架: 钉住外层, 拖动内轨) =================
    var mm = gsap.matchMedia();
    mm.add('(min-width: 768px) and (prefers-reduced-motion: no-preference)', function () {
        var wrap = document.querySelector('[data-pan]');
        var inner = document.querySelector('[data-pan-track]');
        if (!wrap || !inner) return;
        var distance = function () { return Math.max(0, inner.scrollWidth - window.innerWidth); };
        if (distance() < 40) return;   // 内容不够宽就不做横向滚动
        var tween = gsap.to(inner, {
            x: function () { return -distance(); },
            ease: 'none',
            scrollTrigger: {
                trigger: wrap,
                start: 'top top',
                end: function () { return '+=' + distance(); },
                pin: true,
                scrub: 1,
                invalidateOnRefresh: true
            }
        });
        // 每张卡片在自己的横向位置轻微聚焦, 强调"顺序"
        gsap.utils.toArray('.pan-card', inner).forEach(function (card, i) {
            if (i === 0) return;
            gsap.fromTo(card, { autoAlpha: 0.55, scale: 0.97 }, {
                autoAlpha: 1, scale: 1, ease: 'none',
                scrollTrigger: {
                    trigger: card,
                    containerAnimation: tween,
                    start: 'left 92%',
                    end: 'left 55%',
                    scrub: true
                }
            });
        });
        return function () { };
    });
    // 手机: 轨道改成纵向排列, 不做钉住 (回到桌面尺寸时再撤销)
    mm.add('(max-width: 767px)', function () {
        var wrap = document.querySelector('[data-pan]');
        if (!wrap) return;
        wrap.classList.add('pan-static');
        return function () { wrap.classList.remove('pan-static'); };
    });

    // ================= 6. 扫描线: 页面被读回文字 =================
    var scan = document.querySelector('[data-scan]');
    if (scan) {
        var scanBox = scan.parentElement;
        gsap.fromTo(scan, { y: -10, autoAlpha: 0 }, {
            y: function () { return scanBox.offsetHeight; },
            autoAlpha: 1,
            duration: 1.7,
            ease: 'power2.inOut',
            immediateRender: false,
            scrollTrigger: { trigger: scanBox, start: 'top 72%', once: true }
        });
    }

    // ================= 7. 磁吸按钮 + 幕布转场 =================
    if (canHover) {
        document.querySelectorAll('[data-magnetic]').forEach(function (btn) {
            var xTo = gsap.quickTo(btn, 'x', { duration: 0.35, ease: 'power3.out' });
            var yTo = gsap.quickTo(btn, 'y', { duration: 0.35, ease: 'power3.out' });
            btn.addEventListener('pointermove', function (e) {
                var r = btn.getBoundingClientRect();
                xTo(((e.clientX - r.left) / r.width - 0.5) * 14);
                yTo(((e.clientY - r.top) / r.height - 0.5) * 10);
            });
            btn.addEventListener('pointerleave', function () { xTo(0); yTo(0); });
        });
    }
    bindCta(true);

    function bindCta(withCurtain) {
        document.querySelectorAll('[data-cta]').forEach(function (link) {
            link.addEventListener('click', function (e) {
                // 新窗口 / 中键 / 修饰键: 交给浏览器
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                if (!withCurtain) return;
                e.preventDefault();
                var panels = document.querySelectorAll('#curtain span');
                var curtain = document.getElementById('curtain');
                if (!panels.length || !curtain) { window.location.href = link.href; return; }
                curtain.classList.add('on');
                gsap.timeline({ onComplete: function () { window.location.href = link.href; } })
                    .set(panels, { transformOrigin: 'bottom' })
                    .to(panels, { scaleY: 1, duration: 0.42, stagger: 0.045, ease: 'power3.inOut' });
            });
        });
    }

    // 图片按尺寸占位, 但字体/懒加载仍会改变布局, 刷新一次触发点位置
    window.addEventListener('load', function () { ScrollTrigger.refresh(); });

    // 到这里为止没有抛错, 取消 head 里的"强制显示"兜底
    window.__landingReady = true;
})();
