const axios = require('axios');

const CLUB_ID = process.env.CLUB_ID;
const API_KEY = process.env.API_KEY;
const CLUB_SECRET = process.env.CLUB_SECRET;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL; 

const DRY_RUN = false; 

// CONFIGURATIE
const MIN_TOTAL_SINCE_MARCH = 15; 
const MIN_VISITS_RECENT = 15; // Moet 15 keer zijn geweest...
const RECENT_WINDOW_DAYS = 90; // ...in de afgelopen 90 dagen
const ACTIVE_CHECK_DAYS = 3;   // Moet de afgelopen 3 dagen gesport hebben
const MAX_CANDIDATES_PER_RUN = 5;
const START_DATE_BOT = new Date('2024-03-01T00:00:00').getTime();

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function formatPhone(phone) {
    if (!phone) return null;
    let cleaned = phone.replace(/\D/g, ''); 
    if (cleaned.startsWith('00')) cleaned = cleaned.substring(2);
    if (cleaned.startsWith('0') && !cleaned.startsWith('00')) cleaned = '31' + cleaned.substring(1);
    if (!cleaned.startsWith('31')) cleaned = '31' + cleaned;
    return cleaned;
}

async function waitUntilTenAM() {
    const now = new Date();
    const tenAM = new Date();
    tenAM.setHours(10, 0, 0, 0);
    if (now > tenAM) return;
    const msToWait = tenAM - now;
    console.log(`[TIMER] Wachten tot 10:00 uur (${Math.round(msToWait/60000)} min)...`);
    await sleep(msToWait);
}

async function runReviewBot() {
    console.log(`--- [START] NACHT-SCAN (Tempo-check: 15 in 90 dagen) ---`);
    const timestamp90DaysAgo = Date.now() - (RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const timestampActiveRecent = Date.now() - (ACTIVE_CHECK_DAYS * 24 * 60 * 60 * 1000);

    try {
        // Stap 1: Wie was er de afgelopen 3 dagen?
        const res = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/visits`, {
            params: { api_key: API_KEY, club_secret: CLUB_SECRET, sync_from: timestampActiveRecent, limit: 1000 }
        });

        const activeIds = [...new Set((res.data.result || []).map(v => v.member_id))];
        const candidates = [];

        console.log(`Checken van ${activeIds.length} actieve leden...`);

        for (let i = 0; i < activeIds.length; i++) {
            const memberId = activeIds[i];
            
            try {
                // Haal alle bezoeken op vanaf 1 maart
                const hRes = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/visits`, {
                    params: { api_key: API_KEY, club_secret: CLUB_SECRET, member_id: memberId, sync_from: START_DATE_BOT }
                });

                const allVisits = hRes.data.result || [];
                
                // Filter 1: Totaal sinds maart >= 15
                const totalSinceMarch = allVisits.length;
                
                // Filter 2: Hoeveel daarvan waren in de laatste 90 dagen?
                const visitsRecent = allVisits.filter(v => v.check_in_timestamp > timestamp90DaysAgo).length;

                // We triggeren op het moment dat ze de 15e of 16e aantikken in het 90-dagen venster
                if (totalSinceMarch >= MIN_TOTAL_SINCE_MARCH && visitsRecent >= 15 && visitsRecent <= 16) {
                    candidates.push({ id: memberId, count: visitsRecent });
                    console.log(`   [MATCH] Lid ${memberId}: ${visitsRecent} bezoeken in 90 dagen.`);
                }
            } catch (err) {
                if (err.response && err.response.status === 429) { await sleep(120000); i--; continue; }
            }

            await sleep(15000); // 15 sec pauze
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
                    await axios.post(MAKE_WEBHOOK_URL, {
                        telefoon: phone,
                        voornaam: member.firstname,
                        bezoeken: cand.count
                    });
                    console.log(`> Verzonden: ${member.firstname}`);
                    await sleep(5000); // 5 sec tussen webhooks
                }
            }
        }
        console.log("--- KLAAR ---");
    } catch (e) { console.error("Fout:", e.message); }
}

runReviewBot();
