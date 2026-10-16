import { filterGroups, makePlan, planText, rowText, runPlan, summary } from './core.js';

export async function runCli({ getGroups, getChat, ask, print, dryRun, wait, random }) {
    const groups = await getGroups();
    if (groups.length === 0) return print('No groups found.');

    const matches = filterGroups(groups, await ask.search());
    if (matches.length === 0) return print('No groups match the search.');

    const selectedIds = new Set(await ask.select(matches.map((g) => ({ value: g.id, name: rowText(g) }))));
    let selected = matches.filter((g) => selectedIds.has(g.id));
    if (selected.length === 0) return print('No groups selected.');

    const mode = await ask.mode();

    const communities = selected.filter((g) => g.community && !g.left);
    if (communities.length > 0) {
        const names = communities.map((g) => g.name).join(', ');
        const include = await ask.community(
            `These groups belong to a community: ${names}. ` +
                'Leaving them also removes you from the entire community and all its groups. Process them too?',
        );
        if (!include) selected = selected.filter((g) => !communities.includes(g));
        if (selected.length === 0) return print('No groups selected.');
    }

    const plan = makePlan(selected, mode);
    print(`Planned actions (${plan.length} ${plan.length === 1 ? 'group' : 'groups'}):\n${planText(plan)}`);

    if (dryRun) return print('Dry run: nothing was changed.');

    const answer = await ask.confirm();
    if (answer.trim().toLowerCase() !== 'yes') return print('Cancelled. Nothing was changed.');

    const results = await runPlan(plan, { getChat, wait, random, log: print });
    print(summary(results));
}
