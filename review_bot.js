const axios = require('axios');

// OMGEVINGSVARIABELEN (Zorg dat deze in Railway gevuld zijn)
const CLUB_ID = process.env.CLUB_ID;
const API_KEY = process.env.API_KEY;
const CLUB_SECRET = process.env.CLUB_SECRET;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL; 

// CONFIGURATIE
const TRIGGER_MIN = 15; 
const TRIGGER_MAX = 16; 
const RECENT_WINDOW_DAYS = 90; 
const ACTIVE_CHECK_DAYS = 3;   
const MAX_CANDIDATES_PER_RUN = 10; 
const START_DATE_BOT = new Date('2024-03-01T00:00:00').getTime();

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// WhatsApp format helper
function formatPhone(phone) {
    if (!phone) return null;
    let cleaned = phone.replace(/\D/g, ''); 
    if (cleaned.startsWith('00')) cleaned = cleaned.substring(2);
    if (cleaned.startsWith('0') && !cleaned.startsWith('00')) cleaned = '31' + cleaned.substring(1);
    if (!cleaned.startsWith('31')) cleaned = '31' + cleaned;
    return '+' + cleaned;
}

// Timer tot 10:00 uur
async function waitUntilTenAM() {
    const now = new Date();
    const tenAM = new Date();
    tenAM.setHours(10, 0, 0, 0);

    if (now > tenAM) {
        console.log("[TIMER] Het is al na 10:00 uur, we gaan direct door naar verzenden.");
        return;
    }

    const msToWait = tenAM - now;
    console.log(`[TIMER] Scan klaar. We wachten ${Math.round(msToWait/60000)} minuten tot 10:00 uur...`);
    await sleep(msToWait);
}

async function runReviewBot() {
    console.log(`--- [START] SCAN (Met 48u recentheid check) ---`);
    
    const timestamp90DaysAgo = Date.now() - (RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const timestampActiveRecent = Date.now() - (ACTIVE_CHECK_DAYS * 24 * 60 * 60 * 1000);
    const veertigAchtUurGeleden = Date.now() - (48 * 60 * 60 * 1000);

    try {
        // 1. Haal alle leden op die de afgelopen 3 dagen zijn ingecheckt
        const res = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/visits`, {
            params: { api_key: API_KEY, club_secret: CLUB_SECRET, sync_from: timestampActiveRecent, limit: 1000 }
        });

        const activeIds = [...new Set((res.data.result || []).map(v => v.member_id))];
        const candidates = [];

        console.log(`Checken van ${activeIds.length} actieve leden...`);

        for (let i = 0; i < activeIds.length; i++) {
            const memberId = activeIds[i];
            try {
                // 2. Haal de volledige geschiedenis op van dit lid
                const hRes = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/visits`, {
                    params: { api_key: API_KEY, club_secret: CLUB_SECRET, member_id: memberId, sync_from: START_DATE_BOT }
                });

                const allVisits = hRes.data.result || [];
                const totalSinceMarch = allVisits.length;
                const visitsInLast90Days = allVisits.filter(v => v.check_in_timestamp > timestamp90DaysAgo).length;
                
                // Bepaal het allerlaatste bezoek timestamp
                const lastVisitTS = allVisits.length > 0 ? Math.max(...allVisits.map(v => v.check_in_timestamp)) : 0;

                // 3. Controleer op mijlpaal (15/16) EN of ze recent (max 48u geleden) zijn geweest
                if (totalSinceMarch >= TRIGGER_MIN && totalSinceMarch <= TRIGGER_MAX && visitsInLast90Days >= 15) {
                    if (lastVisitTS > veertigAchtUurGeleden) {
                        candidates.push({ id: memberId, count: totalSinceMarch });
                        console.log(`   [MATCH] Lid ${memberId} gevonden (${totalSinceMarch} bezoeken, laatste bezoek was recent).`);
                    } else {
                        console.log(`   [SKIP] Lid ${memberId} staat op ${totalSinceMarch}, maar is niet recent geweest (voorkomt spam).`);
                    }
                }
            } catch (err) {
                if (err.response && err.response.status === 429) { 
                    console.log("Rate limit bereikt! 2 min pauze...");
                    await sleep(120000); i--; continue; 
                }
            }
            
            await sleep(5000); // 5 seconden pauze tussen leden om VG API te ontlasten
            if (candidates.length >= MAX_CANDIDATES_PER_RUN) break;
        }

        // 4. Wachten tot 10:00 uur en dan pas de webhooks naar Make sturen
        if (candidates.length > 0) {
            await waitUntilTenAM();
            
            for (const cand of candidates) {
                const mRes = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/member/${cand.id}`, {
                    params: { api_key: API_KEY, club_secret: CLUB_SECRET }
                });
                const member = Array.isArray(mRes.data.result) ? mRes.data.result[0] : mRes.data.result;
                
                if (member && MAKE_WEBHOOK_URL) {
                    const phone = formatPhone(member.mobile || member.phone);
                    if (phone) {
                        console.log(`> Verzenden naar Make: ${member.firstname} (${phone}) - ${cand.count} bezoeken`);
                        await axios.post(MAKE_WEBHOOK_URL, {
                            telefoon: phone,
                            voornaam: member.firstname,
                            bezoeken: cand.count
                        });
                        await sleep(5000); 
                    }
                }
            }
        }
        
        console.log("--- SCAN VOLTOOID ---");
    } catch (e) { 
        console.error("Fout tijdens uitvoering:", e.message); 
    }
}

// Start het script
runReviewBot();
