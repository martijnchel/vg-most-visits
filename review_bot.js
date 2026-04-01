const axios = require('axios');

// OMGEVINGSVARIABELEN
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

// STARTDATUM OP 1 MAART 2026
const START_DATE_BOT = new Date('2026-03-01T00:00:00').getTime();

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function formatPhone(phone) {
    if (!phone) return null;
    let cleaned = phone.replace(/\D/g, ''); 
    if (cleaned.startsWith('00')) cleaned = cleaned.substring(2);
    if (cleaned.startsWith('0') && !cleaned.startsWith('00')) cleaned = '31' + cleaned.substring(1);
    if (!cleaned.startsWith('31')) cleaned = '31' + cleaned;
    return '+' + cleaned;
}

async function waitUntilTenAM() {
    const now = new Date();
    const tenAM = new Date();
    tenAM.setHours(10, 0, 0, 0);
    if (now > tenAM) return;
    const msToWait = tenAM - now;
    console.log(`[TIMER] Scan klaar. Wachten tot 10:00 uur voor verzenden...`);
    await sleep(msToWait);
}

async function runReviewBot() {
    console.log(`--- [START] SCAN (Sinds 1 Maart 2026 + 90 dgn check) ---`);
    
    const timestamp90DaysAgo = Date.now() - (RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const timestampActiveRecent = Date.now() - (ACTIVE_CHECK_DAYS * 24 * 60 * 60 * 1000);
    const veertigAchtUurGeleden = Date.now() - (48 * 60 * 60 * 1000);

    try {
        // 1. Haal actieve leden van de afgelopen 3 dagen op
        const res = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/visits`, {
            params: { api_key: API_KEY, club_secret: CLUB_SECRET, sync_from: timestampActiveRecent, limit: 1000 }
        });

        const activeIds = [...new Set((res.data.result || []).map(v => v.member_id))];
        const candidates = [];

        console.log(`Analyse van ${activeIds.length} actieve leden...`);

        for (let i = 0; i < activeIds.length; i++) {
            const memberId = activeIds[i];
            try {
                // 2. Haal bezoeken op vanaf de startdatum (Maart 2026)
                const hRes = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/visits`, {
                    params: { api_key: API_KEY, club_secret: CLUB_SECRET, member_id: memberId, sync_from: START_DATE_BOT }
                });

                const allVisits = hRes.data.result || [];
                const visitsInLast90Days = allVisits.filter(v => v.check_in_timestamp > timestamp90DaysAgo).length;
                const lastVisitTS = allVisits.length > 0 ? Math.max(...allVisits.map(v => v.check_in_timestamp)) : 0;

                // 3. Mijlpaal check: Zit het lid op 15 of 16 bezoeken in de laatste 90 dagen?
                if (visitsInLast90Days >= TRIGGER_MIN && visitsInLast90Days <= TRIGGER_MAX) {
                    // Alleen als ze recent (48u) zijn geweest sturen we ze door naar Make
                    if (lastVisitTS > veertigAchtUurGeleden) {
                        candidates.push({ id: memberId, count: visitsInLast90Days });
                        console.log(`   [MATCH] Lid ${memberId} gevonden (${visitsInLast90Days} bezoeken).`);
                    }
                }
            } catch (err) {
                if (err.response && err.response.status === 429) { 
                    console.log("Rate limit... even geduld.");
                    await sleep(60000); i--; continue; 
                }
            }
            
            await sleep(2500); 
            if (candidates.length >= MAX_CANDIDATES_PER_RUN) break;
        }

        // 4. Wachten tot 10:00 en verzenden naar Make
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
                        console.log(`> Naar Make: ${member.firstname} (${cand.count}x)`);
                        await axios.post(MAKE_WEBHOOK_URL, {
                            telefoon: phone,
                            voornaam: member.firstname,
                            bezoeken: cand.count,
                            member_id: cand.id // Handig voor je Google Sheets check!
                        });
                        await sleep(2000); 
                    }
                }
            }
        }
        console.log("--- SCAN VOLTOOID ---");
    } catch (e) { console.error("Fout:", e.message); }
}

runReviewBot();
