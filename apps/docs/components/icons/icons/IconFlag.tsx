// Generated from svgs/IconFlag.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconFlag = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M4.033.252C5.31.106 6.893.359 8.835 1.33l.259.125c2.633 1.229 4.099.542 4.626.015l.085-.073A.75.75 0 0 1 15 2v8c0 .199-.08.39-.22.531-1.088 1.088-3.271 1.703-6.318.284l-.297-.144c-1.741-.87-3.033-1.035-3.96-.929-.745.085-1.3.35-1.705.631v4.877a.75.75 0 0 1-1.5 0V2q0-.03.003-.059v-.017a.7.7 0 0 1 .044-.18q.01-.03.023-.06a1 1 0 0 1 .074-.122.8.8 0 0 1 .126-.138A5.17 5.17 0 0 1 4.033.252m4.132 2.419c-1.741-.87-3.033-1.035-3.96-.929-.745.085-1.3.35-1.705.631v6.29c.435-.19.943-.344 1.533-.411 1.277-.146 2.86.107 4.802 1.078l.259.125c2.331 1.088 3.746.673 4.406.198v-6.31c-1.206.46-2.912.462-5.038-.528z" clip-rule="evenodd"/></svg>
	);
};

export { IconFlag as ReactComponent };