const axios = require('axios');

const CLUB_ID = process.env.CLUB_ID;
const API_KEY = process.env.API_KEY;
const CLUB_SECRET = process.env.CLUB_SECRET;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL; 

// TEST MODUS: Zet op false als je echt wilt gaan verzenden
const DRY_RUN = true; 

const MIN_VISITS = 15; 
const MAX_VISITS = 18; 
const RECENT_DAYS = 4; 

function formatPhone(phone) {
    if (!phone) return null;
    let cleaned = phone.replace(/\D/g, ''); 
    if (cleaned.startsWith('00')) cleaned = cleaned.substring(2);
    if (cleaned.startsWith('0')) cleaned = '31' + cleaned.substring(1);
    if (!cleaned.startsWith('31')) cleaned = '31' + cleaned;
    return cleaned;
}

async function runReviewBot() {
    console.log(`[${DRY_RUN ? 'TEST-MODUS' : 'LIVE-MODUS'}] Scan start...`);
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
            return count >= MIN_VISITS && count <= MAX_VISITS && lastVisitTimestamp[id] > recentThreshold;
        });
        
        console.log(`Totaal gevonden in Virtuagym: ${visits.length} check-ins.`);
        console.log(`Aantal matches voor review (15-18 bezoeken): ${candidates.length}`);

        for (const memberId of candidates.slice(0, 10)) { // Toon er max 10 in de logs
            const mRes = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/member/${memberId}`, {
                params: { api_key: API_KEY, club_secret: CLUB_SECRET }
            });
            const member = mRes.data.result[0] || mRes.data.result;

            if (member) {
                const phone = formatPhone(member.mobile || member.phone);
                console.log(`> KANDIDAAT: ${member.firstname} ${member.lastname || ''} | Bezoeken: ${counts[memberId]} | Tel: ${phone}`);
                
                if (!DRY_RUN && phone && MAKE_WEBHOOK_URL) {
                    await axios.post(MAKE_WEBHOOK_URL, { telefoon: phone, voornaam: member.firstname });
                    console.log(`  [VERSTUURD NAAR MAKE]`);
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
        }
        console.log("Scan voltooid.");
    } catch (e) { console.error("Fout:", e.message); }
}

runReviewBot();
