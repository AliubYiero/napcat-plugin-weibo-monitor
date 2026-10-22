import { useState } from 'react';
import { usePageRoute } from '../hooks/usePageRoute';
import { useSubscriptions } from '../hooks/useSubscriptions';
import AddSubscriptionDialog from './subscriptions/AddSubscriptionDialog';
import LimitsTab from './subscriptions/LimitsTab';
import SubscriptionsTab from './subscriptions/SubscriptionsTab';

type TabId = 'list' | 'limits';

export default function SubscriptionsPage() {
    const [, navigate] = usePageRoute();
    const {
        subscriptions,
        sessions,
        sessionNames,
        filtered,
        keyword,
        setKeyword,
        loading,
        refreshing,
        refresh,
        remove,
    } = useSubscriptions();
    const [tab, setTab] = useState<TabId>('list');
    const [dialogOpen, setDialogOpen] = useState(false);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64 empty-state">
                <div className="flex flex-col items-center gap-3">
                    <div className="loading-spinner text-primary" />
                    <div className="text-gray-400 text-sm">
                        正在加载订阅数据...
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-1 border-b border-gray-100 dark:border-gray-800 animate-fade-in-down">
                <button
                    type="button"
                    className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                        tab === 'list'
                            ? 'border-primary text-primary'
                            : 'border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                    }`}
                    onClick={() => setTab('list')}
                >
                    订阅列表
                </button>
                <button
                    type="button"
                    className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                        tab === 'limits'
                            ? 'border-primary text-primary'
                            : 'border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                    }`}
                    onClick={() => setTab('limits')}
                >
                    订阅上限
                </button>
            </div>

            {tab === 'list' ? (
                <SubscriptionsTab
                    subscriptions={subscriptions}
                    filtered={filtered}
                    sessionNames={sessionNames}
                    keyword={keyword}
                    onKeywordChange={setKeyword}
                    onAdd={() => setDialogOpen(true)}
                    onRemove={remove}
                    onRefresh={refresh}
                    refreshing={refreshing}
                />
            ) : (
                <LimitsTab sessionNames={sessionNames} />
            )}

            <AddSubscriptionDialog
                open={dialogOpen}
                sessions={sessions}
                subscriptions={subscriptions}
                onClose={() => setDialogOpen(false)}
                onAdded={refresh}
                onOpenSessions={() => {
                    setDialogOpen(false);
                    navigate('sessions');
                }}
                onOpenLimits={() => {
                    setDialogOpen(false);
                    setTab('limits');
                }}
            />
        </div>
    );
}
