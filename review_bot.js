const axios = require('axios');

const CLUB_ID = process.env.CLUB_ID;
const API_KEY = process.env.API_KEY;
const CLUB_SECRET = process.env.CLUB_SECRET;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL; 

// TEST-MODUS: Op true laten voor de webhook test!
const DRY_RUN = true; 

// CONFIGURATIE (Vanaf 1 maart 2024)
const MIN_VISITS = 15; 
const MAX_VISITS = 16; 
const RECENT_DAYS = 3; 
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

async function runReviewBot() {
    console.log(`--- [WEBHOOK-TEST] START SCAN ---`);
    const timestampRecent = Date.now() - (RECENT_DAYS * 24 * 60 * 60 * 1000);

    try {
        console.log(`Stap 1: Actieve leden ophalen...`);
        const res = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/visits`, {
            params: { api_key: API_KEY, club_secret: CLUB_SECRET, sync_from: timestampRecent, limit: 1000 }
        });

        const recentVisits = res.data.result || [];
        const uniqueMemberIds = [...new Set(recentVisits.map(v => v.member_id))];
        
        console.log(`Analyse van ${uniqueMemberIds.length} actieve leden...`);

        for (let i = 0; i < uniqueMemberIds.length; i++) {
            const memberId = uniqueMemberIds[i];
            
            const historyRes = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/visits`, {
                params: { 
                    api_key: API_KEY, 
                    club_secret: CLUB_SECRET, 
                    member_id: memberId,
                    sync_from: START_DATE_BOT 
                }
            });

            const count = (historyRes.data.result || []).length;
            
            if (count >= MIN_VISITS && count <= MAX_VISITS) {
                // MATCH GEVONDEN! Nu gegevens ophalen voor de test
                const mRes = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/member/${memberId}`, {
                    params: { api_key: API_KEY, club_secret: CLUB_SECRET }
                });
                const member = Array.isArray(mRes.data.result) ? mRes.data.result[0] : mRes.data.result;

                if (member) {
                    const phone = formatPhone(member.mobile || member.phone);
                    console.log(`> TEST-DATA verzenden voor: ${member.firstname} (${count} bezoeken)`);
                    
                    await axios.post(MAKE_WEBHOOK_URL, {
                        telefoon: phone,
                        voornaam: member.firstname,
                        bezoeken: count,
                        member_id: memberId
                    });

                    console.log(`✅ Verzonden! Check nu Make.`);
                    return; // STOP HET SCRIPT NA 1 VERZENDING
                }
            }

            await sleep(2000); // Korte pauze tijdens de test
            if (i % 5 === 0) console.log(`Checken... ${i}/${uniqueMemberIds.length}`);
        }

        console.log("Geen matches gevonden in de laatste 3 dagen om te testen.");
    } catch (e) { console.error("Fout:", e.message); }
}

runReviewBot();
