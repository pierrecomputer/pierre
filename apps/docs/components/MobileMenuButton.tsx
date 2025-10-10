import Button from './Button';
import styles from './MobileMenuButton.module.css';
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
      className={`${styles.mobileMenuButton} ${className ?? ''}`}
      aria-label="Toggle navigation menu"
    >
      <IconParagraph />
      Menu
    </Button>
  );
};

export default MobileMenuButton;
