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
      className={`hidden md:hidden mb-4 place-self-start ${className ?? ''}`}
      aria-label="Toggle navigation menu"
    >
      <IconParagraph />
      Menu
    </Button>
  );
};

export default MobileMenuButton;
