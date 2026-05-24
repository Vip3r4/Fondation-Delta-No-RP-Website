document.addEventListener('DOMContentLoaded', () => {
    
    const scrollOptions = {
        threshold: 0.15,
        rootMargin: "0px 0px -50px 0px"
    };

    const scrollObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {

                entry.target.classList.add('visible');
                
                const stats = entry.target.querySelectorAll('.count');
                if (stats.length > 0) {
                    stats.forEach(s => animateNumber(s));
                }
                
                scrollObserver.unobserve(entry.target);
            }
        });
    }, scrollOptions);

    document.querySelectorAll('.anim-fade-up').forEach(el => scrollObserver.observe(el));

    function animateNumber(el) {
        const target = parseInt(el.getAttribute('data-target'));
        const duration = 2000;
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
    }

    document.addEventListener('mousemove', (e) => {
        document.body.style.setProperty('--mouse-x', e.clientX + 'px');
        document.body.style.setProperty('--mouse-y', e.clientY + 'px');
    });

    fetchPlayerCount();
    setInterval(fetchPlayerCount, 30000);
});

function copyIP(ip) {
    navigator.clipboard.writeText(ip).then(() => {
        const notif = document.getElementById('copy-notification');
        notif.classList.add('show');
        setTimeout(() => notif.classList.remove('show'), 2000);
    });
}

async function fetchPlayerCount() {
    try {
        const response = await fetch('http://83.150.218.120:5000/api/server-info');
        
        if (!response.ok) throw new Error("Erreur réseau");
        
        const data = await response.json();
        
        const countElement = document.getElementById('player-count');
        if (countElement) {
            countElement.innerText = `${data.players} / ${data.max_players}`;
        }
    } catch (error) {
        console.error("Erreur de récupération :", error);
    }
}

function toggleDropdown() {
    const menu = document.getElementById("filterMenu");
    menu.classList.toggle("show");
}

function copyEmail(email) {
    navigator.clipboard.writeText(email).then(function() {
        const btnText = document.getElementById('email-btn-text');
        if (btnText) {
            btnText.textContent = 'Email copié !';
            setTimeout(() => {
                btnText.textContent = 'Copier l\'email';
            }, 2000);
        }
    }).catch(function(err) {
        console.error('Erreur lors de la copie:', err);
    });
}