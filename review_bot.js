const axios = require('axios');

const CLUB_ID = process.env.CLUB_ID;
const API_KEY = process.env.API_KEY;
const CLUB_SECRET = process.env.CLUB_SECRET;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL; 

// TEST-MODUS: Zet op false om echt naar Make te sturen
const DRY_RUN = true; 

// CONFIGURATIE VOOR REVIEW
const MIN_VISITS = 15; 
const MAX_VISITS = 22; // Iets ruimer om meer kans te maken in de test
const RECENT_DAYS = 7; // Iets ruimer (laatste week) om te zien of we mensen vangen

function formatPhone(phone) {
    if (!phone) return null;
    let cleaned = phone.replace(/\D/g, ''); 
    if (cleaned.startsWith('00')) cleaned = cleaned.substring(2);
    if (cleaned.startsWith('0')) cleaned = '31' + cleaned.substring(1);
    if (!cleaned.startsWith('31')) cleaned = '31' + cleaned;
    return cleaned;
}

async function runReviewBot() {
    console.log(`--- [${DRY_RUN ? 'TEST-MODE' : 'LIVE-MODE'}] START SCAN ---`);
    
    // We kijken 90 dagen terug voor de teller, maar we halen de LAATSTE 1000 checkins op
    const timestamp90DaysAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);

    try {
        console.log("Ophalen van check-ins bij Virtuagym...");
        const response = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/visits`, {
            params: { 
                api_key: API_KEY, 
                club_secret: CLUB_SECRET, 
                sync_from: timestamp90DaysAgo, 
                limit: 1000 
            }
        });

        const visits = response.data.result || [];
        
        if (visits.length === 0) {
            console.log("Geen check-ins gevonden in deze periode. Controleer je API-gegevens.");
            return;
        }

        // Sorteer check-ins op tijd (nieuwste eerst) voor de teller
        visits.sort((a, b) => b.check_in_timestamp - a.check_in_timestamp);

        const firstDate = new Date(visits[visits.length - 1].check_in_timestamp).toLocaleDateString();
        const lastDate = new Date(visits[0].check_in_timestamp).toLocaleDateString();
        console.log(`Scan bereik: ${visits.length} check-ins gevonden tussen ${firstDate} en ${lastDate}`);

        const counts = {};
        const lastVisitTimestamp = {};

        visits.forEach(v => { 
            counts[v.member_id] = (counts[v.member_id] || 0) + 1;
            if (!lastVisitTimestamp[v.member_id] || v.check_in_timestamp > lastVisitTimestamp[v.member_id]) {
                lastVisitTimestamp[v.member_id] = v.check_in_timestamp;
            }
        });

        const recentThreshold = Date.now() - (RECENT_DAYS * 24 * 60 * 60 * 1000);
        
        // Filter kandidaten
        const candidates = Object.keys(counts).filter(id => {
            const count = counts[id];
            const lastVisit = lastVisitTimestamp[id];
            return count >= MIN_VISITS && count <= MAX_VISITS && lastVisit > recentThreshold;
        });
        
        console.log(`Kandidaten die voldoen aan filter (${MIN_VISITS}-${MAX_VISITS} bezoeken & recent geweest): ${candidates.length}`);

        // Verwerk de eerste 5 (of minder)
        const batch = candidates.slice(0, 5);

        for (const memberId of batch) {
            const mRes = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/member/${memberId}`, {
                params: { api_key: API_KEY, club_secret: CLUB_SECRET }
            });
            
            // Virtuagym API returns result as array or object
            const member = Array.isArray(mRes.data.result) ? mRes.data.result[0] : mRes.data.result;

            if (member) {
                const phone = formatPhone(member.mobile || member.phone);
                console.log(`> MATCH: ${member.firstname} | Bezoeken: ${counts[memberId]} | Laatst gezien: ${new Date(lastVisitTimestamp[memberId]).toLocaleDateString()} | Tel: ${phone || 'GEEN NUMMER'}`);
                
                if (!DRY_RUN && phone && MAKE_WEBHOOK_URL) {
                    await axios.post(MAKE_WEBHOOK_URL, {
                        telefoon: phone,
                        voornaam: member.firstname,
                        member_id: memberId,
                        bezoeken: counts[memberId]
                    });
                    console.log(`  [VERSTUURD NAAR MAKE]`);
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
        }

        if (candidates.length === 0) {
            console.log("Geen matches gevonden. Tip: Als het bereik (dates) nog te oud is, verlaag de '90 days' naar '30 days' in de code.");
        }

        console.log("--- SCAN VOLTOOID ---");
    } catch (e) {
        console.error("KRITIEKE FOUT:", e.response ? e.response.data : e.message);
    }
}

runReviewBot();
