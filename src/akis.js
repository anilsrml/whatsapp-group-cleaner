import { filtrele, planla, planMetni, satirMetni, uygula, ozet } from './cekirdek.js';

export async function akis({ gruplariGetir, sohbetAl, sor, yaz, deneme, bekle, rastgele }) {
    const gruplar = await gruplariGetir();
    if (gruplar.length === 0) return yaz('No groups found.');

    const liste = filtrele(gruplar, await sor.filtre());
    if (liste.length === 0) return yaz('No groups match the search.');

    const secilenIdler = new Set(
        await sor.sec(liste.map((g) => ({ value: g.id, name: satirMetni(g) }))),
    );
    let secilenler = liste.filter((g) => secilenIdler.has(g.id));
    if (secilenler.length === 0) return yaz('No groups selected.');

    const mod = await sor.mod();

    const topluluklar = secilenler.filter((g) => g.topluluk && !g.cikilmis);
    if (topluluklar.length > 0) {
        const adlar = topluluklar.map((g) => g.ad).join(', ');
        const devam = await sor.topluluk(
            `These groups belong to a community: ${adlar}. ` +
                'Leaving them also removes you from the entire community and all its groups. Process them too?',
        );
        if (!devam) secilenler = secilenler.filter((g) => !topluluklar.includes(g));
        if (secilenler.length === 0) return yaz('No groups selected.');
    }

    const plan = planla(secilenler, mod);
    yaz(`Planned actions (${plan.length} ${plan.length === 1 ? 'group' : 'groups'}):\n${planMetni(plan)}`);

    if (deneme) return yaz('Dry run: nothing was changed.');

    const cevap = await sor.onay();
    if (cevap.trim().toLowerCase() !== 'yes') return yaz('Cancelled. Nothing was changed.');

    const sonuclar = await uygula(plan, { sohbetAl, bekle, rastgele, bildir: yaz });
    yaz(ozet(sonuclar));
}
