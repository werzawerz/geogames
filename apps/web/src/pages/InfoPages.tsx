import { href } from '../router.ts';

const UPDATED = '16 November 2026';

function Draft() {
  return (
    <p className="draft-note" role="note">
      <strong>Draft – to be reviewed.</strong> This text is not final and has not been reviewed by a lawyer.
    </p>
  );
}

export function AboutPage() {
  return (
    <div className="page prose">
      <h1 className="page-title">About GeoGames</h1>
      <p>
        GeoGames is a free collection of geography games for the browser: maps, borders, cities, flags and capitals. There are no ads and no
        paywall. Every game is a short run that gets harder as you go, so you can play for two minutes or twenty.
      </p>
      <h2>Scores and leaderboards</h2>
      <p>
        Each game has a leaderboard. When a run ends, the site replays your moves against the game rules to check the score before it counts, so
        a leaderboard entry is always a score the game could really produce. You play under a name you choose (you can change it on your
        Profile page). The daily challenges give everyone the same run, with one try a day and a new one at midnight UTC, and they have their own
        daily leaderboard. How the data is handled is described in the <a href={href({ page: 'privacy' })}>privacy policy</a>.
      </p>
      <h2 id="data">Data sources and licences</h2>
      <p>The games stand on open data. Thank you to everyone who publishes it.</p>
      <ul>
        <li>
          <strong>World Bank World Development Indicators</strong> (population, GDP, GDP per capita, life expectancy): CC BY 4.0.
        </li>
        <li>
          <strong>UN World Urbanization Prospects 2018 and 2025</strong> (city populations): CC BY 3.0 IGO.
        </li>
        <li>
          <strong>GeoNames</strong> (places, city names and coordinates): CC BY 4.0.
        </li>
        <li>
          <strong>Wikidata</strong> (facts and aliases): CC0.
        </li>
        <li>
          <strong>Euromonitor International</strong> city destination rankings (which cities count as well known).
        </li>
        <li>
          <strong>mledoze/countries</strong> (country names, codes, capitals, borders): Open Database Licence (ODbL).
        </li>
        <li>
          <strong>Natural Earth</strong> (country outlines, rivers, physical features and the shaded-relief terrain maps): public domain.
        </li>
        <li>
          <strong>flag-icons</strong> (flag images): MIT licence.
        </li>
      </ul>
      <p className="muted">
        Figures are the latest the sources publish and can differ from other counts, because countries and agencies define cities and borders
        differently. If you spot a mistake, tell us on the <a href={href({ page: 'contact' })}>contact page</a>.
      </p>
    </div>
  );
}

export function PrivacyPage() {
  return (
    <div className="page prose">
      <h1 className="page-title">Privacy policy</h1>
      <Draft />
      <p className="muted">Last updated: {UPDATED}</p>

      <h2>Who is responsible</h2>
      <p>
        The controller of your personal data is <strong>[Operator name]</strong>, [Country]. You can reach us through the{' '}
        <a href={href({ page: 'contact' })}>Contact page</a>.
      </p>

      <h2>What we store, and why</h2>
      <ul>
        <li>
          <strong>An anonymous account id</strong>, created the first time you play, so your scores and progress stay yours.
        </li>
        <li>
          <strong>Your player name</strong>, which you choose. It is shown on leaderboards, so do not use your real name if you prefer not to be
          identified.
        </li>
        <li>
          <strong>Game moves and scores</strong>, for the leaderboards, for checking that scores are fair, and for saving your progress and
          personal bests.
        </li>
        <li>
          <strong>If you sign in with Google:</strong> your email address, name and profile picture as Google provides them, so you can get back to
          the same account on another device.
        </li>
        <li>
          <strong>Feedback messages</strong> you send through the Contact page, with the contact address you give, so we can read and answer them.
        </li>
      </ul>
      <p>
        The legal basis is our legitimate interest in running the games and their leaderboards (Article 6(1)(f) GDPR) and, for sign-in and for
        messages you send us, your own request (Article 6(1)(b) and (a)). We do not use your data for advertising or profiling.
      </p>

      <h2>Who processes it</h2>
      <ul>
        <li>
          <strong>Supabase</strong>: the database and sign-in service that stores the data above.
        </li>
        <li>
          <strong>GitHub Pages</strong>: hosts the website files. GitHub receives the technical data of every page request, such as your IP address.
        </li>
        <li>
          <strong>Google</strong>: only if you choose to sign in with Google, under Google's own privacy policy.
        </li>
      </ul>
      <p>
        These providers may process data outside the European Economic Area, under the safeguards GDPR requires, such as standard contractual
        clauses.
      </p>

      <h2>Ads, cookies and tracking</h2>
      <p>
        There are no ads, no analytics and no tracking cookies. The site only uses your browser's local storage, to keep your session and your
        settings (such as theme and game options). It stays on your device and is needed for the site to work, so no consent banner is needed.
      </p>

      <h2>How long we keep it</h2>
      <p>
        Account data and scores are kept while your account exists. When you delete your account, your personal data is removed, and your
        leaderboard entries are removed or made anonymous. Feedback messages are kept for as long as needed to deal with them, and no longer than
        12 months. Accounts that were never used again may be deleted after 24 months of inactivity.
      </p>

      <h2>Your rights</h2>
      <p>
        You have the right to access your data, to have it corrected, deleted or restricted, to object to its use, and to receive a copy of it. To
        delete your data yourself, open your Profile page and choose <strong>Delete my account</strong>. For anything else, use the{' '}
        <a href={href({ page: 'contact' })}>Contact page</a>. You also have the right to complain to a data protection authority; in Hungary this
        is the Nemzeti Adatvédelmi és Információszabadság Hatóság (NAIH).
      </p>

      <h2>Changes</h2>
      <p>If this policy changes, the date above changes with it.</p>
    </div>
  );
}

export function TermsPage() {
  return (
    <div className="page prose">
      <h1 className="page-title">Terms of use</h1>
      <Draft />
      <p className="muted">Last updated: {UPDATED}</p>
      <ul>
        <li>
          <strong>Free service.</strong> GeoGames is free to use. It is run by <strong>[Operator name]</strong>, [Country], and may change or stop
          at any time.
        </li>
        <li>
          <strong>Play fair.</strong> No cheating: do not use bots, scripts or tools that solve the games, and do not tamper with scores or the
          service.
        </li>
        <li>
          <strong>Keep names clean.</strong> Player names must not be abusive, hateful, sexual or impersonate someone else. We may change such a
          name.
        </li>
        <li>
          <strong>Scores can be removed.</strong> We may remove scores, or accounts, that look unfair or break these rules, and reset leaderboards
          when games change.
        </li>
        <li>
          <strong>No warranty.</strong> The service and its data are provided as they are, without promises of accuracy or availability. To the
          extent the law allows, we are not liable for losses from using the site.
        </li>
        <li>
          <strong>Data licences.</strong> The games use open data from third parties under their own licences, listed on the{' '}
          <a href={href({ page: 'about' })}>About page</a>.
        </li>
        <li>
          <strong>Privacy.</strong> How personal data is handled is described in the <a href={href({ page: 'privacy' })}>privacy policy</a>.
        </li>
      </ul>
    </div>
  );
}

export function ContactPage() {
  return (
    <div className="page prose">
      <h1 className="page-title">Contact</h1>
      <p>Feedback, a mistake in the data, a bug, or a request about your personal data: write to us here.</p>
      <div className="contact-form-slot" />
    </div>
  );
}
