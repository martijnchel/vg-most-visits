const axios = require('axios');

const CLUB_ID = process.env.CLUB_ID;
const API_KEY = process.env.API_KEY;
const CLUB_SECRET = process.env.CLUB_SECRET;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL; 

const DRY_RUN = false; 

// CONFIGURATIE
const TRIGGER_MIN = 15; // De unieke triggerwaarde
const TRIGGER_MAX = 16; // Margerandje voor als ze 2x vlak achter elkaar komen
const RECENT_WINDOW_DAYS = 90; 
const ACTIVE_CHECK_DAYS = 3;   
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
    console.log(`[TIMER] Wachten tot 10:00 uur...`);
    await sleep(msToWait);
}

async function runReviewBot() {
    console.log(`--- [START] NACHT-SCAN (Eénmalige trigger na 1 maart) ---`);
    const timestamp90DaysAgo = Date.now() - (RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const timestampActiveRecent = Date.now() - (ACTIVE_CHECK_DAYS * 24 * 60 * 60 * 1000);

    try {
        const res = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/visits`, {
            params: { api_key: API_KEY, club_secret: CLUB_SECRET, sync_from: timestampActiveRecent, limit: 1000 }
        });

        const activeIds = [...new Set((res.data.result || []).map(v => v.member_id))];
        const candidates = [];

        for (let i = 0; i < activeIds.length; i++) {
            const memberId = activeIds[i];
            try {
                const hRes = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/visits`, {
                    params: { api_key: API_KEY, club_secret: CLUB_SECRET, member_id: memberId, sync_from: START_DATE_BOT }
                });

                const allVisits = hRes.data.result || [];
                const totalSinceMarch = allVisits.length;
                const visitsInLast90Days = allVisits.filter(v => v.check_in_timestamp > timestamp90DaysAgo).length;

                // DE CRUCIALE CHECK:
                // 1. Totaal sinds 1 maart is precies 15 of 16 (zorgt voor éénmalig bericht)
                // 2. Tempo in de laatste 90 dagen is ook 15+ (zorgt dat het een actieve sporter is)
                if (totalSinceMarch >= TRIGGER_MIN && totalSinceMarch <= TRIGGER_MAX && visitsInLast90Days >= 15) {
                    candidates.push({ id: memberId, count: totalSinceMarch });
                    console.log(`[MATCH] Lid ${memberId} tikt de 15 aan sinds 1 maart!`);
                }
            } catch (err) {
                if (err.response && err.response.status === 429) { await sleep(120000); i--; continue; }
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
                    await axios.post(MAKE_WEBHOOK_URL, { telefoon: phone, voornaam: member.firstname, bezoeken: cand.count });
                    console.log(`> Verzonden: ${member.firstname}`);
                    await sleep(5000);
                }
            }
        }
        console.log("--- KLAAR ---");
    } catch (e) { console.error("Fout:", e.message); }
}

runReviewBot();
