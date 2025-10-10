import NavLink from './NavLink';
import {
  IconBook,
  IconBoxTape,
  IconCodeBlock,
  IconGear,
  IconGrid2x1,
  IconLifeRaft,
  IconServer,
  IconTerminal,
} from './icons';

const DocsSidebar = () => {
  return (
    <aside className="docs-sidebar">
      <nav className="docs-nav">
        <NavLink href="/docs#install" icon={<IconBoxTape />} active={true}>
          Install
        </NavLink>
        <NavLink href="/docs#usage" icon={<IconCodeBlock />}>
          Usage
        </NavLink>
        <NavLink href="/docs#configuration" icon={<IconGear />}>
          Configuration
        </NavLink>
        <NavLink href="/docs#components" icon={<IconGrid2x1 />}>
          Components
        </NavLink>

        <div className="nav-subsection">
          <NavLink href="/docs#file">File</NavLink>
          <NavLink href="/docs#file-header">FileHeader</NavLink>
          <NavLink href="/docs#hunk">Hunk</NavLink>
          <NavLink href="/docs#hunk-divider">HunkDivider</NavLink>
          <NavLink href="/docs#extending">Extending components</NavLink>
        </div>

        <NavLink href="/docs#cli" icon={<IconTerminal />}>
          CLI
        </NavLink>
        <NavLink href="/docs#api" icon={<IconBook />}>
          API Reference
        </NavLink>

        <div className="nav-divider" />

        <NavLink
          href="https://code-storage.example.com"
          icon={<IconServer />}
          external
        >
          Code Storage
        </NavLink>
        <NavLink
          href="https://support.example.com"
          icon={<IconLifeRaft />}
          external
        >
          Support
        </NavLink>
      </nav>
    </aside>
  );
};

export default DocsSidebar;
