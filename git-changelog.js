import { createWriteStream } from 'fs';
import { Repository } from 'nodegit';
import { resolve as resolvePath } from 'path';
import moment from 'moment';

const dateRange = process.argv.slice(2);
const allCommits = dateRange.length === 0;
if (dateRange.length < 2) {
  console.log('setting second date');
  dateRange[1] = new Date();
}

let inputError = false;
if (!allCommits) {
  if (!moment(new Date(dateRange[0])).isValid()) {
    console.error('Invalid starting date given');
    inputError = true;
  }

  if (!moment(new Date(dateRange[1])).isValid()) {
    console.error('Invalid ending date given');
    inputError = true;
  }
}

if (inputError) process.exit();

const getCsvRow = columns =>
  `${columns.reduce(
    (rowString, column) => `${rowString}"${column.replace(/"/g, '""')}",`,
    ''
  )}\n`;

(async () => {
  try {
    const repo = await Repository.openBare(resolvePath('./.git'));
    const config = await repo.config();
    const remote = await config.getStringBuf('remote.origin.url');
    const namespace = /github\.com(?::|\/)(.*?\/.*?)\.git/i.exec(remote)[1];
    const company = namespace.split('/')[0];
    const firstCommitOnMaster = await repo.getMasterCommit();
    const history = firstCommitOnMaster.history();
    const rows = {};
    const dateSet = new Set();
    history.on('commit', commit => {
      const commitDate = commit.date();
      if (
        !allCommits &&
        !moment(commitDate).isBetween(
          moment(dateRange[0]),
          moment(dateRange[1]).add(1, 'day')
        )
      ) return;
      try {
        const author = commit.author();
        const summary = commit.summary();
        const jiraTicketNumber = /^(.*?-[0-9]{1}[0-9]*)/g.exec(summary)[0];
        const timestamp = commitDate.valueOf();
        dateSet.add(timestamp);
        rows[timestamp] =
          (rows[timestamp] || '') +
          getCsvRow([
            moment(commitDate).format('YYYY-MM-DD'),
            author.name(),
            author.email(),
            summary,
            commit.body() || ' ',
            `https://${company}.atlassian.net/browse/${jiraTicketNumber}`,
            `https://github.com/${namespace}/commit/${commit.sha()}`,
          ]);
      } catch (err) {
        // console.error(err);
      }
    });
    history.on('end', async () => {
      const dates = [...dateSet];
      dates.sort((date1, date2) => {
        if (moment(date1).isAfter(date2)) return 1;
        if (moment(date1).isBefore(date2)) return -1;
        return 0;
      });
      const csv = dates.map(date => rows[date] || '').join('');
      const filename =
        `./${
          namespace.split('/')[1]
        }_changelog_${
          allCommits ?
            'all-commits' :
            `${
              moment(dateRange[0]).format('YYYY-MM-DD')
            }_${
              moment(dateRange[1]).format('YYYY-MM-DD')
            }`
        }.csv`;
      const writeStream = createWriteStream(filename);
      await new Promise(
        resolve =>
          writeStream.write(
            getCsvRow([
              '📅 Date of Change',
              '😀 Author Name',
              '📩 Author Email',
              '❗️ Summary',
              '‼️ Body',
              '🔗 Jira Link',
              '🐙😺 Github Link',
            ]),
            resolve
          )
      );
      await new Promise(
        resolve => writeStream.write(csv, resolve)
      );
      await new Promise(
        resolve => writeStream.close(resolve)
      );
    });
    history.start();
  } catch (err) {
    console.error(err);
  }
})();
