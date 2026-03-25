const axios = require('axios');

const CLUB_ID = process.env.CLUB_ID;
const API_KEY = process.env.API_KEY;
const CLUB_SECRET = process.env.CLUB_SECRET;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL; 

// CONFIGURATIE
const MIN_VISITS = 15; // Trigger vanaf 15 bezoeken
const MAX_VISITS = 18; // Stop met triggeren na 18 (om dubbele apps te voorkomen)
const RECENT_DAYS = 4; // Moet in de afgelopen 4 dagen nog zijn geweest

function formatPhone(phone) {
    if (!phone) return null;
    let cleaned = phone.replace(/\D/g, ''); 
    if (cleaned.startsWith('00')) cleaned = cleaned.substring(2);
    if (cleaned.startsWith('0')) cleaned = '31' + cleaned.substring(1);
    if (!cleaned.startsWith('31')) cleaned = '31' + cleaned;
    return cleaned;
}

async function runReviewBot() {
    console.log(`Zoeken naar leden met ${MIN_VISITS} tot ${MAX_VISITS} bezoeken...`);
    
    // Timestamp van 90 dagen geleden
    const timestamp = Date.now() - (90 * 24 * 60 * 60 * 1000);

    try {
        const response = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/visits`, {
            params: { api_key: API_KEY, club_secret: CLUB_SECRET, sync_from: timestamp, limit: 1000 }
        });

        const visits = response.data.result || [];
        const counts = {};
        const lastVisitTimestamp = {};

        visits.forEach(v => { 
            counts[v.member_id] = (counts[v.member_id] || 0) + 1;
            if (!lastVisitTimestamp[v.member_id] || v.check_in_timestamp > lastVisitTimestamp[v.member_id]) {
                lastVisitTimestamp[v.member_id] = v.check_in_timestamp;
            }
        });

        const recentThreshold = Date.now() - (RECENT_DAYS * 24 * 60 * 60 * 1000);
        
        const candidates = Object.keys(counts).filter(id => {
            const count = counts[id];
            const lastVisit = lastVisitTimestamp[id];
            // Filter: Zit tussen 15-18 bezoeken EN was er onlangs nog
            return count >= MIN_VISITS && count <= MAX_VISITS && lastVisit > recentThreshold;
        });
        
        console.log(`Kandidaten gevonden: ${candidates.length}`);

        // We beperken het tot max 5 per run om Make/WhatsApp niet te overbelasten
        const batch = candidates.slice(0, 5);

        for (const memberId of batch) {
            const mRes = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/member/${memberId}`, {
                params: { api_key: API_KEY, club_secret: CLUB_SECRET }
            });
            const member = mRes.data.result[0] || mRes.data.result;

            if (member && (member.mobile || member.phone)) {
                const formattedPhone = formatPhone(member.mobile || member.phone);
                if (formattedPhone) {
                    await axios.post(MAKE_WEBHOOK_URL, {
                        telefoon: formattedPhone,
                        voornaam: member.firstname
                    });
                    console.log(`Gestuurd naar Make: ${member.firstname} (${formattedPhone})`);
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
        }
        console.log("Klaar!");
    } catch (e) {
        console.error("Fout:", e.message);
    }
}

runReviewBot();
