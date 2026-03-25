const axios = require('axios');

const CLUB_ID = process.env.CLUB_ID;
const API_KEY = process.env.API_KEY;
const CLUB_SECRET = process.env.CLUB_SECRET;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL; 

const DRY_RUN = false; 

// CONFIGURATIE
const TRIGGER_MIN = 15; 
const TRIGGER_MAX = 16; 
const RECENT_WINDOW_DAYS = 90; 
const ACTIVE_CHECK_DAYS = 3;   
const MAX_CANDIDATES_PER_RUN = 5;
const START_DATE_BOT = new Date('2024-03-01T00:00:00').getTime();

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Aangepaste functie voor WhatsApp format met +
function formatPhone(phone) {
    if (!phone) return null;
    let cleaned = phone.replace(/\D/g, ''); 
    if (cleaned.startsWith('00')) cleaned = cleaned.substring(2);
    if (cleaned.startsWith('0') && !cleaned.startsWith('00')) cleaned = '31' + cleaned.substring(1);
    if (!cleaned.startsWith('31')) cleaned = '31' + cleaned;
    
    // Voeg de verplichte + toe voor de WhatsApp module
    return '+' + cleaned;
}

async function waitUntilTenAM() {
    const now = new Date();
    const tenAM = new Date();
    tenAM.setHours(10, 0, 0, 0);

    // Als het al na 10:00 is (bijv. bij handmatige start), gaan we direct door
    if (now > tenAM) {
        console.log("[TIMER] Het is al na 10:00 uur, we starten direct met verzenden.");
        return;
    }

    const msToWait = tenAM - now;
    console.log(`[TIMER] Scan klaar. We wachten ${Math.round(msToWait/60000)} minuten tot het 10:00 uur is...`);
    await sleep(msToWait);
}

async function runReviewBot() {
    console.log(`--- [START] NACHT-SCAN (Met +31 format) ---`);
    const timestamp90DaysAgo = Date.now() - (RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const timestampActiveRecent = Date.now() - (ACTIVE_CHECK_DAYS * 24 * 60 * 60 * 1000);

    try {
        const res = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/visits`, {
            params: { api_key: API_KEY, club_secret: CLUB_SECRET, sync_from: timestampActiveRecent, limit: 1000 }
        });

        const activeIds = [...new Set((res.data.result || []).map(v => v.member_id))];
        const candidates = [];

        console.log(`Checken van ${activeIds.length} actieve leden...`);

        for (let i = 0; i < activeIds.length; i++) {
            const memberId = activeIds[i];
            try {
                const hRes = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/visits`, {
                    params: { api_key: API_KEY, club_secret: CLUB_SECRET, member_id: memberId, sync_from: START_DATE_BOT }
                });

                const allVisits = hRes.data.result || [];
                const totalSinceMarch = allVisits.length;
                const visitsInLast90Days = allVisits.filter(v => v.check_in_timestamp > timestamp90DaysAgo).length;

                if (totalSinceMarch >= TRIGGER_MIN && totalSinceMarch <= TRIGGER_MAX && visitsInLast90Days >= 15) {
                    candidates.push({ id: memberId, count: totalSinceMarch });
                    console.log(`   [MATCH] Lid ${memberId} gevonden (${totalSinceMarch} bezoeken totaal).`);
                }
            } catch (err) {
                if (err.response && err.response.status === 429) { 
                    console.log("Rate limit! 2 min rust...");
                    await sleep(120000); i--; continue; 
                }
            }
            await sleep(15000); 
            if (candidates.length >= MAX_CANDIDATES_PER_RUN) break;
        }

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
                        console.log(`> Verzenden naar Make: ${member.firstname} (${phone})`);
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
    } catch (e) { console.error("Fout:", e.message); }
}

runReviewBot();
