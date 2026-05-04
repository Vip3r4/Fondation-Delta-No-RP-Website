function toggleDropdown() {
            const menu = document.getElementById("filterMenu");
            const btn = document.querySelector(".filter-btn");
            menu.classList.toggle("show");
            btn.classList.toggle("active");
        }

        window.onclick = function(event) {
            if (!event.target.closest('.filter-btn')) {
                const menu = document.getElementById("filterMenu");
                const btn = document.querySelector(".filter-btn");
                if (menu && menu.classList.contains('show')) {
                    menu.classList.remove('show');
                    btn.classList.remove('active');
                }
            }
        }

document.addEventListener('mousemove', (e) => {
            document.body.style.setProperty('--mouse-x', e.clientX + 'px');
            document.body.style.setProperty('--mouse-y', e.clientY + 'px');
        });

function copyIP(ip) {
            navigator.clipboard.writeText(ip)
                .then(() => {
                    const notification = document.getElementById('copy-notification');
                    notification.classList.add('show');

                    setTimeout(() => {
                        notification.classList.remove('show');
                    }, 2000);
                })
                .catch(() => {
                    alert("Impossible de copier l'IP");
                });
        }

async function fetchPlayerCount() {
            try {
                const res = await fetch('/.netlify/functions/players');
                const data = await res.json();

                const online = data.Success && data.Servers.length > 0;
                const players = online ? data.Servers[0].Players : '-- / --';

                document.getElementById('player-count').textContent = players;

                const dot = document.querySelector('.card-online-dot');
                const label = document.querySelector('.card-online');

                if (online) {
                    dot.style.background = '#4ade80';
                    label.style.color = '#4ade80';
                    label.lastChild.textContent = ' En Ligne';
                } else {
                    dot.style.background = '#f87171';
                    label.style.color = '#f87171';
                    label.lastChild.textContent = ' Hors Ligne';
                }
            } catch (err) {
                console.error('CATCH:', err.message);
            }
        }

        fetchPlayerCount();
        setInterval(fetchPlayerCount, 30000);

document.addEventListener("DOMContentLoaded", () => {
        const counters = document.querySelectorAll('.count');
        
        const startCounter = (el) => {
            const target = parseInt(el.getAttribute('data-target'));
            const duration = 3000;
            const step = target / (duration / 10);
            let current = 0;

            const timer = setInterval(() => {
                current += step;
                if (current >= target) {
                    el.innerText = target;
                    clearInterval(timer);
                } else {
                    el.innerText = Math.floor(current);
                }
            }, 10);
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {

                    entry.target.classList.add('active');
                    
                    const sectionCounters = entry.target.querySelectorAll('.count');
                    sectionCounters.forEach(count => startCounter(count));
                    
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.3 });

        const statsSection = document.querySelector('.hero-stats');
        if (statsSection) observer.observe(statsSection);
    });