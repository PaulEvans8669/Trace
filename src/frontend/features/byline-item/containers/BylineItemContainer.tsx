import { BylineItemView } from '../components/BylineItemView';
import { useBylineItemData } from '../hooks/useBylineItemData';

export const BylineItemContainer = () => {
  const model = useBylineItemData();
  return <BylineItemView model={model} />;
};
