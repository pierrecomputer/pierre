import Button from './Button';
import { IconParagraph } from './icons';

interface MobileMenuButtonProps {
  onClick: () => void;
  isOpen?: boolean;
  className?: string;
}

const MobileMenuButton = ({ onClick, className }: MobileMenuButtonProps) => {
  return (
    <Button
      onClick={onClick}
      className={`mb-4 hidden place-self-start md:hidden ${className ?? ''}`}
      aria-label="Toggle navigation menu"
    >
      <IconParagraph />
      Menu
    </Button>
  );
};

export default MobileMenuButton;
