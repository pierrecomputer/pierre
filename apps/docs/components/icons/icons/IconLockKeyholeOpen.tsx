// Generated from svgs/IconLockKeyholeOpen.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconLockKeyholeOpen = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M7.5 9.5a1.5 1.5 0 0 1-.736 1.291l.517 1.55a.5.5 0 0 1-.475.659H5.194a.5.5 0 0 1-.475-.658l.517-1.55A1.5 1.5 0 1 1 7.5 9.5"/><path d="M12 1.5A2.5 2.5 0 0 0 9.5 4v1.198C11.5 5.636 12 6.902 12 10v1c0 4.118-.883 5-5 5H5c-4.117 0-5-.883-5-5v-1c0-4.117.883-5 5-5h2q.535 0 1 .021V4a4 4 0 1 1 8 0v2.167h-1.5V4A2.5 2.5 0 0 0 12 1.5M1.667 7.807C1.554 8.307 1.5 9.005 1.5 10v1c0 .995.055 1.692.167 2.193.107.483.246.686.35.79s.307.243.79.35c.5.112 1.198.167 2.193.167h2c.995 0 1.692-.055 2.193-.166.483-.108.686-.247.79-.35.104-.105.243-.308.35-.791.112-.5.167-1.198.167-2.193v-1c0-.995-.055-1.692-.166-2.193-.108-.483-.247-.686-.35-.79-.105-.104-.308-.243-.791-.35C8.693 6.555 7.995 6.5 7 6.5H5c-.995 0-1.692.055-2.193.167-.483.107-.686.246-.79.35s-.243.307-.35.79" clip-rule="evenodd"/></svg>
	);
};

export { IconLockKeyholeOpen as ReactComponent };