const axios = require('axios');

const CLUB_ID = process.env.CLUB_ID;
const API_KEY = process.env.API_KEY;
const CLUB_SECRET = process.env.CLUB_SECRET;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL; 

const DRY_RUN = true; // Zet op false om echt te verzenden

// STRATEGIE: We triggeren alleen op het 15e of 16e bezoek.
const MIN_VISITS = 15; 
const MAX_VISITS = 16; 
const RECENT_DAYS = 4; // Ze moeten in de afgelopen 4 dagen zijn geweest (sinds de vorige scan)

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
    console.log(`Doelgroep: Leden op hun 15e of 16e bezoek.`);
    
    const timestampRecent = Date.now() - (RECENT_DAYS * 24 * 60 * 60 * 1000); 

    try {
        const response = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/visits`, {
            params: { 
                api_key: API_KEY, 
                club_secret: CLUB_SECRET, 
                sync_from: timestampRecent,
                limit: 1000 
            }
        });

        const recentVisits = response.data.result || [];
        if (recentVisits.length === 0) return console.log("Geen recente bezoekers.");

        const uniqueMemberIds = [...new Set(recentVisits.map(v => v.member_id))];
        const candidates = [];
        const timestamp90Days = Date.now() - (90 * 24 * 60 * 60 * 1000);

        for (const memberId of uniqueMemberIds) {
            const memberVisitsRes = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/visits`, {
                params: { 
                    api_key: API_KEY, 
                    club_secret: CLUB_SECRET, 
                    sync_from: timestamp90Days,
                    member_id: memberId 
                }
            });

            const count = (memberVisitsRes.data.result || []).length;

            // Alleen toevoegen als ze PRECIES op 15 of 16 zitten
            if (count >= MIN_VISITS && count <= MAX_VISITS) {
                candidates.push({ id: memberId, count: count });
            }
            await new Promise(r => setTimeout(r, 100));
        }
        
        console.log(`Kandidaten gevonden: ${candidates.length}`);

        for (const cand of candidates.slice(0, 5)) {
            const mRes = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/member/${cand.id}`, {
                params: { api_key: API_KEY, club_secret: CLUB_SECRET }
            });
            
            const member = Array.isArray(mRes.data.result) ? mRes.data.result[0] : mRes.data.result;

            if (member) {
                const phone = formatPhone(member.mobile || member.phone);
                if (phone) {
                    console.log(`> TARGET: ${member.firstname} | Bezoek #${cand.count} | Tel: ${phone}`);
                    
                    if (!DRY_RUN && MAKE_WEBHOOK_URL) {
                        await axios.post(MAKE_WEBHOOK_URL, {
                            telefoon: phone,
                            voornaam: member.firstname,
                            bezoeken: cand.count
                        });
                        await new Promise(r => setTimeout(r, 1000));
                    }
                }
            }
        }
        console.log("--- SCAN VOLTOOID ---");
    } catch (e) { console.error("FOUT:", e.message); }
}

runReviewBot();
