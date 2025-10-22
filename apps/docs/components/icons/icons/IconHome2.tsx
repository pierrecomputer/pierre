// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconHome2({
  size = 16,
  color = 'currentcolor',
  style,
  className,
  ...props
}: IconProps) {
  const height = size;
  const width = size === '1em' ? '1em' : Math.round(Number(size) * 1.125);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 18 16"
      width={width}
      height={height}
      fill={Colors[color] ?? color}
      style={style}
      className={`pi${className ? ` ${className}` : ''}`}
      {...props}
    >
      <path d="M8 6c0-.828.172-1 1-1s1 .172 1 1-.172 1-1 1-1-.172-1-1" />
      <path
        d="M8.496.195a.75.75 0 0 1 1.009 0L13 3.373V2.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v2.691L16.99 7H17v.01l.755.685a.75.75 0 0 1-.767 1.258c-.029 1.103-.116 2.057-.294 2.872-.23 1.05-.624 1.916-1.289 2.58s-1.53 1.058-2.58 1.289C11.784 15.922 10.516 16 9 16s-2.784-.078-3.825-.306c-1.05-.23-1.916-.624-2.58-1.289s-1.058-1.53-1.288-2.58c-.18-.815-.266-1.769-.295-2.872a.75.75 0 0 1-.766-1.258L1 7.009V7h.01zM2.5 7.673V8c0 1.484.078 2.622.272 3.503.191.873.485 1.443.883 1.842.399.398.97.692 1.842.883.435.096.932.163 1.503.207V9.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v4.935a11 11 0 0 0 1.503-.207c.873-.191 1.443-.485 1.842-.883.398-.399.692-.97.883-1.842.194-.88.272-2.02.272-3.503v-.327L9 1.763z"
        clip-rule="evenodd"
      />
    </svg>
  );
}
